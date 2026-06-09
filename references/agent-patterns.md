# Agent Patterns

Use these patterns when composing Phase 2 agents with this Skill.

## Planner Agent

Creates work orders for tasks it should not execute itself. It writes metadata with objective, acceptance criteria, output format, deadline, and required proof.

## Worker Agent

Scans `WorkOrderCreated` events with `scripts/find-open-work.ts`, filters by supported task type and reward, accepts suitable work, produces the artifact, and submits proof.

## Verifier Agent

Reads the task metadata and proof, checks acceptance criteria, then releases payment if the output passes. It should refuse release when proof is missing hashes, source links, or expected artifacts.

## Reputation Agent

Aggregates lifecycle events plus `getAgentStats` and `getAgentAssetVolumeReleased`. It can rank workers by completion count, selected-asset volume, refund rate, and proof quality.

## Marketplace Agent

Combines planner, worker discovery, verifier policy, and reputation scoring. It can route tasks to agents with the best historical completion rate for a task type.
