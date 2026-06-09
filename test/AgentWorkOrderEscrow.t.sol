// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../assets/AgentWorkOrderEscrow.sol";
import "../assets/MockERC20.sol";

interface Vm {
    function warp(uint256 newTimestamp) external;
}

contract AgentWorkOrderEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    AgentWorkOrderEscrow private escrow;
    MockERC20 private token;

    WorkerActor private worker;
    WorkerActor private otherWorker;
    VerifierActor private verifier;
    BuyerActor private buyer;
    BuyerActor private nativeBuyer;

    constructor() payable {}

    function beforeEach() public {
        escrow = new AgentWorkOrderEscrow();
        token = new MockERC20();
        token.mint(address(this), 1_000_000_000);
    }

    function testCreateAcceptSubmitReleaseErc20() public {
        beforeEach();
        token.approve(address(escrow), 10_000_000);
        worker = new WorkerActor();
        verifier = new VerifierActor();

        uint256 id = escrow.createWorkOrder(
            address(worker),
            address(verifier),
            address(token),
            10_000_000,
            uint64(block.timestamp + 1 days),
            "ipfs://task"
        );

        worker.accept(escrow, id);
        worker.submit(escrow, id, "ipfs://proof");
        verifier.release(escrow, id);

        AgentWorkOrderEscrow.WorkOrder memory order = escrow.getWorkOrder(id);
        AgentWorkOrderEscrow.AgentStats memory stats = escrow.getAgentStats(address(worker));

        require(uint256(order.status) == uint256(AgentWorkOrderEscrow.Status.Released), "not released");
        require(token.balanceOf(address(worker)) == 10_000_000, "worker not paid");
        require(stats.completed == 1, "completion stat missing");
        require(
            escrow.getAgentAssetVolumeReleased(address(worker), address(token)) == 10_000_000,
            "asset volume missing"
        );
    }

    function testCreateOpenErc20AndCancel() public {
        beforeEach();
        token.approve(address(escrow), 5_000_000);

        uint256 id = escrow.createWorkOrder(
            address(0),
            address(0),
            address(token),
            5_000_000,
            uint64(block.timestamp + 1 days),
            "ipfs://open-task"
        );

        escrow.cancelOpen(id);
        AgentWorkOrderEscrow.WorkOrder memory order = escrow.getWorkOrder(id);
        require(uint256(order.status) == uint256(AgentWorkOrderEscrow.Status.Cancelled), "not cancelled");
        require(token.balanceOf(address(this)) == 1_000_000_000, "not refunded");
    }

    function testDesignatedWorkerEnforced() public {
        beforeEach();
        worker = new WorkerActor();
        otherWorker = new WorkerActor();
        token.approve(address(escrow), 1_000_000);

        uint256 id = escrow.createWorkOrder(
            address(worker),
            address(0),
            address(token),
            1_000_000,
            uint64(block.timestamp + 1 days),
            "ipfs://designated-task"
        );

        require(!otherWorker.tryAccept(escrow, id), "wrong worker accepted");
        require(worker.tryAccept(escrow, id), "designated worker rejected");
    }

    function testUnauthorizedReleaseRejected() public {
        beforeEach();
        worker = new WorkerActor();
        otherWorker = new WorkerActor();
        verifier = new VerifierActor();
        token.approve(address(escrow), 1_000_000);

        uint256 id = escrow.createWorkOrder(
            address(worker),
            address(verifier),
            address(token),
            1_000_000,
            uint64(block.timestamp + 1 days),
            "ipfs://release-task"
        );

        worker.accept(escrow, id);
        worker.submit(escrow, id, "ipfs://proof");

        require(!otherWorker.tryRelease(escrow, id), "unauthorized release accepted");
        require(token.balanceOf(address(worker)) == 0, "paid before authorized release");

        verifier.release(escrow, id);
        require(token.balanceOf(address(worker)) == 1_000_000, "authorized release failed");
    }

    function testExpiredRefundFromAcceptedOrder() public {
        beforeEach();
        buyer = new BuyerActor();
        worker = new WorkerActor();
        token.mint(address(buyer), 2_000_000);

        uint256 id = buyer.createErc20Order(
            escrow,
            token,
            address(worker),
            address(0),
            2_000_000,
            uint64(block.timestamp + 1),
            "ipfs://refund-task"
        );

        worker.accept(escrow, id);
        require(!buyer.tryRefund(escrow, id), "refunded before deadline");
        vm.warp(block.timestamp + 2);
        buyer.refund(escrow, id);

        AgentWorkOrderEscrow.WorkOrder memory order = escrow.getWorkOrder(id);
        require(uint256(order.status) == uint256(AgentWorkOrderEscrow.Status.Refunded), "not refunded");
        require(token.balanceOf(address(buyer)) == 2_000_000, "buyer not refunded");
    }

    function testNativeEscrowRelease() public {
        beforeEach();
        nativeBuyer = new BuyerActor();
        worker = new WorkerActor();
        verifier = new VerifierActor();
        payable(address(nativeBuyer)).transfer(1 ether);

        uint256 id = nativeBuyer.createNativeOrder(
            escrow,
            address(worker),
            address(verifier),
            1 ether,
            uint64(block.timestamp + 1 days),
            "ipfs://native-task"
        );

        worker.accept(escrow, id);
        worker.submit(escrow, id, "ipfs://native-proof");
        uint256 beforeBalance = address(worker).balance;
        verifier.release(escrow, id);

        AgentWorkOrderEscrow.WorkOrder memory order = escrow.getWorkOrder(id);
        require(uint256(order.status) == uint256(AgentWorkOrderEscrow.Status.Released), "not released");
        require(address(worker).balance == beforeBalance + 1 ether, "worker native balance wrong");
    }

    function testErc20ApproveFailureRejected() public {
        beforeEach();

        try escrow.createWorkOrder(
            address(0),
            address(0),
            address(token),
            1_000_000,
            uint64(block.timestamp + 1 days),
            "ipfs://unapproved"
        ) returns (uint256) {
            revert("unapproved create succeeded");
        } catch {
            require(token.balanceOf(address(escrow)) == 0, "escrow received tokens");
        }
    }

    receive() external payable {}
}

contract WorkerActor {
    receive() external payable {}

    function accept(AgentWorkOrderEscrow escrow, uint256 id) external {
        escrow.acceptWorkOrder(id);
    }

    function tryAccept(AgentWorkOrderEscrow escrow, uint256 id) external returns (bool) {
        try escrow.acceptWorkOrder(id) {
            return true;
        } catch {
            return false;
        }
    }

    function submit(AgentWorkOrderEscrow escrow, uint256 id, string calldata proofURI) external {
        escrow.submitProof(id, proofURI);
    }

    function tryRelease(AgentWorkOrderEscrow escrow, uint256 id) external returns (bool) {
        try escrow.releasePayment(id) {
            return true;
        } catch {
            return false;
        }
    }
}

contract VerifierActor {
    function release(AgentWorkOrderEscrow escrow, uint256 id) external {
        escrow.releasePayment(id);
    }
}

contract BuyerActor {
    function createErc20Order(
        AgentWorkOrderEscrow escrow,
        MockERC20 token,
        address worker,
        address verifier,
        uint256 amount,
        uint64 deadline,
        string calldata metadataURI
    ) external returns (uint256) {
        token.approve(address(escrow), amount);
        return escrow.createWorkOrder(worker, verifier, address(token), amount, deadline, metadataURI);
    }

    function createNativeOrder(
        AgentWorkOrderEscrow escrow,
        address worker,
        address verifier,
        uint256 amount,
        uint64 deadline,
        string calldata metadataURI
    ) external payable returns (uint256) {
        return escrow.createWorkOrder{value: amount}(worker, verifier, address(0), amount, deadline, metadataURI);
    }

    function tryRefund(AgentWorkOrderEscrow escrow, uint256 id) external returns (bool) {
        try escrow.refundExpired(id) {
            return true;
        } catch {
            return false;
        }
    }

    function refund(AgentWorkOrderEscrow escrow, uint256 id) external {
        escrow.refundExpired(id);
    }

    receive() external payable {}
}
