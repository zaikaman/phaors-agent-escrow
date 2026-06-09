// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract AgentWorkOrderEscrow {
    enum Status {
        None,
        Open,
        Accepted,
        Submitted,
        Released,
        Refunded,
        Cancelled
    }

    struct WorkOrder {
        address buyer;
        address worker;
        address verifier;
        address asset;
        uint256 amount;
        uint64 workDeadline;
        uint64 reviewDeadline;
        uint64 createdAt;
        uint64 acceptedAt;
        uint64 submittedAt;
        Status status;
        string metadataURI;
        string proofURI;
    }

    struct AgentStats {
        uint256 posted;
        uint256 accepted;
        uint256 submitted;
        uint256 completed;
        uint256 refunded;
        uint256 volumeReleased;
    }

    uint256 public nextWorkOrderId = 1;

    mapping(uint256 => WorkOrder) private workOrders;
    mapping(address => AgentStats) private agentStats;
    mapping(address => mapping(address => uint256)) private agentAssetVolumeReleased;

    bool private locked;

    event WorkOrderCreated(
        uint256 indexed id,
        address indexed buyer,
        address indexed worker,
        address verifier,
        address asset,
        uint256 amount,
        uint64 workDeadline,
        uint64 reviewDeadline,
        string metadataURI
    );
    event WorkOrderAccepted(uint256 indexed id, address indexed worker);
    event ProofSubmitted(uint256 indexed id, address indexed worker, string proofURI);
    event PaymentReleased(uint256 indexed id, address indexed worker, address asset, uint256 amount);
    event WorkOrderRefunded(uint256 indexed id, address indexed buyer, address asset, uint256 amount);
    event WorkOrderCancelled(uint256 indexed id, address indexed buyer, address asset, uint256 amount);

    error Reentrancy();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidMetadata();
    error InvalidProof();
    error InvalidStatus(Status actual);
    error Unauthorized();
    error WorkDeadlinePassed();
    error WorkDeadlineNotPassed();
    error ReviewDeadlineNotPassed();
    error NativeAmountMismatch();
    error NativeTransferFailed();
    error TokenTransferFailed();
    error MissingWorkOrder();

    modifier nonReentrant() {
        if (locked) revert Reentrancy();
        locked = true;
        _;
        locked = false;
    }

    function createWorkOrder(
        address worker,
        address verifier,
        address asset,
        uint256 amount,
        uint64 workDeadline,
        uint64 reviewDeadline,
        string calldata metadataURI
    ) external payable nonReentrant returns (uint256 id) {
        if (amount == 0) revert InvalidAmount();
        uint64 currentTime = uint64(block.timestamp);
        if (workDeadline <= currentTime || reviewDeadline <= workDeadline) revert InvalidDeadline();
        if (bytes(metadataURI).length == 0) revert InvalidMetadata();

        if (asset == address(0)) {
            if (msg.value != amount) revert NativeAmountMismatch();
        } else {
            if (msg.value != 0) revert NativeAmountMismatch();
            _safeTransferFrom(asset, msg.sender, address(this), amount);
        }

        id = nextWorkOrderId++;
        workOrders[id] = WorkOrder({
            buyer: msg.sender,
            worker: worker,
            verifier: verifier,
            asset: asset,
            amount: amount,
            workDeadline: workDeadline,
            reviewDeadline: reviewDeadline,
            createdAt: currentTime,
            acceptedAt: 0,
            submittedAt: 0,
            status: Status.Open,
            metadataURI: metadataURI,
            proofURI: ""
        });

        agentStats[msg.sender].posted += 1;

        emit WorkOrderCreated(id, msg.sender, worker, verifier, asset, amount, workDeadline, reviewDeadline, metadataURI);
    }

    function acceptWorkOrder(uint256 id) external {
        WorkOrder storage order = _existingOrder(id);
        if (order.status != Status.Open) revert InvalidStatus(order.status);
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime > order.workDeadline) revert WorkDeadlinePassed();
        if (order.worker != address(0) && order.worker != msg.sender) revert Unauthorized();

        order.worker = msg.sender;
        order.acceptedAt = currentTime;
        order.status = Status.Accepted;

        agentStats[msg.sender].accepted += 1;

        emit WorkOrderAccepted(id, msg.sender);
    }

    function submitProof(uint256 id, string calldata proofURI) external {
        WorkOrder storage order = _existingOrder(id);
        if (order.status != Status.Accepted) revert InvalidStatus(order.status);
        if (order.worker != msg.sender) revert Unauthorized();
        if (uint64(block.timestamp) > order.workDeadline) revert WorkDeadlinePassed();
        if (bytes(proofURI).length == 0) revert InvalidProof();

        order.proofURI = proofURI;
        order.submittedAt = uint64(block.timestamp);
        order.status = Status.Submitted;

        agentStats[msg.sender].submitted += 1;

        emit ProofSubmitted(id, msg.sender, proofURI);
    }

    function releasePayment(uint256 id) external nonReentrant {
        WorkOrder storage order = _existingOrder(id);
        if (order.status != Status.Submitted) revert InvalidStatus(order.status);
        if (msg.sender != order.buyer && msg.sender != order.verifier) revert Unauthorized();

        order.status = Status.Released;
        agentStats[order.worker].completed += 1;
        agentStats[order.worker].volumeReleased += order.amount;
        agentAssetVolumeReleased[order.worker][order.asset] += order.amount;

        _payout(order.asset, order.worker, order.amount);

        emit PaymentReleased(id, order.worker, order.asset, order.amount);
    }

    function refundExpired(uint256 id) external nonReentrant {
        WorkOrder storage order = _existingOrder(id);
        if (msg.sender != order.buyer) revert Unauthorized();
        uint64 currentTime = uint64(block.timestamp);
        if (order.status == Status.Open || order.status == Status.Accepted) {
            if (currentTime <= order.workDeadline) revert WorkDeadlineNotPassed();
        } else if (order.status == Status.Submitted) {
            if (currentTime <= order.reviewDeadline) revert ReviewDeadlineNotPassed();
        } else {
            revert InvalidStatus(order.status);
        }

        order.status = Status.Refunded;
        agentStats[order.buyer].refunded += 1;

        _payout(order.asset, order.buyer, order.amount);

        emit WorkOrderRefunded(id, order.buyer, order.asset, order.amount);
    }

    function cancelOpen(uint256 id) external nonReentrant {
        WorkOrder storage order = _existingOrder(id);
        if (msg.sender != order.buyer) revert Unauthorized();
        if (order.status != Status.Open) revert InvalidStatus(order.status);

        order.status = Status.Cancelled;

        _payout(order.asset, order.buyer, order.amount);

        emit WorkOrderCancelled(id, order.buyer, order.asset, order.amount);
    }

    function getWorkOrder(uint256 id) external view returns (WorkOrder memory) {
        if (workOrders[id].buyer == address(0)) revert MissingWorkOrder();
        return workOrders[id];
    }

    function getAgentStats(address agent) external view returns (AgentStats memory) {
        return agentStats[agent];
    }

    function getAgentAssetVolumeReleased(address agent, address asset) external view returns (uint256) {
        return agentAssetVolumeReleased[agent][asset];
    }

    function _existingOrder(uint256 id) private view returns (WorkOrder storage order) {
        order = workOrders[id];
        if (order.buyer == address(0)) revert MissingWorkOrder();
    }

    function _payout(address asset, address to, uint256 amount) private {
        if (asset == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            _safeTransfer(asset, to, amount);
        }
    }

    function _safeTransfer(address asset, address to, uint256 amount) private {
        (bool ok, bytes memory data) = asset.call(
            abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenTransferFailed();
    }

    function _safeTransferFrom(address asset, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = asset.call(
            abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenTransferFailed();
    }
}
