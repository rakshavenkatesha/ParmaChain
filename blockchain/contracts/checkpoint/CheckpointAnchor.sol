// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CheckpointAnchor
 * @notice Deployed on a PUBLIC chain (Polygon Amoy, or a local stand-in). Consortium members
 *         periodically anchor the private QBFT chain's (blockNumber, blockHash, stateRoot,
 *         validatorSetHash). Anyone can then audit the permissioned ledger without joining it:
 *         if the consortium ever rewrites history, its block hash at an anchored height no longer
 *         matches the public record.
 *
 *         A second, DIFFERENT hash submitted for an already anchored height is never overwritten:
 *         it is stored and emitted as Equivocation - public evidence of a fork / rewrite attempt.
 */
contract CheckpointAnchor {
    struct Checkpoint {
        uint64 blockNumber;
        bytes32 blockHash;
        bytes32 stateRoot;
        bytes32 validatorSetHash;
        address publisher;
        uint64 anchoredAt;
    }

    struct EquivocationRecord {
        uint256 consortiumChainId;
        uint64 blockNumber;
        bytes32 anchoredHash;
        bytes32 conflictingHash;
        address publisher;
        uint64 reportedAt;
    }

    address public owner;
    mapping(address => bool) public isPublisher;

    /// consortiumChainId => blockNumber => checkpoint
    mapping(uint256 => mapping(uint64 => Checkpoint)) private _checkpoints;
    /// consortiumChainId => ordered list of anchored heights
    mapping(uint256 => uint64[]) private _heights;
    EquivocationRecord[] private _equivocations;

    event PublisherSet(address indexed publisher, bool allowed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event CheckpointAnchored(uint256 indexed consortiumChainId, uint64 indexed blockNumber, bytes32 blockHash, bytes32 stateRoot, bytes32 validatorSetHash, address indexed publisher);
    event Equivocation(uint256 indexed consortiumChainId, uint64 indexed blockNumber, bytes32 anchoredHash, bytes32 conflictingHash, address indexed publisher);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        isPublisher[msg.sender] = true;
        emit PublisherSet(msg.sender, true);
    }

    function setPublisher(address publisher, bool allowed) external onlyOwner {
        require(publisher != address(0), "Zero publisher");
        isPublisher[publisher] = allowed;
        emit PublisherSet(publisher, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @return equivocation true if this submission conflicted with an existing anchor.
     */
    function submitCheckpoint(
        uint256 consortiumChainId,
        uint64 blockNumber,
        bytes32 blockHash,
        bytes32 stateRoot,
        bytes32 validatorSetHash
    ) external returns (bool equivocation) {
        require(isPublisher[msg.sender], "Not an authorised publisher");
        require(blockHash != bytes32(0), "Empty block hash");

        Checkpoint storage existing = _checkpoints[consortiumChainId][blockNumber];
        if (existing.blockHash != bytes32(0)) {
            require(existing.blockHash != blockHash, "Checkpoint already anchored");
            _equivocations.push(
                EquivocationRecord({
                    consortiumChainId: consortiumChainId,
                    blockNumber: blockNumber,
                    anchoredHash: existing.blockHash,
                    conflictingHash: blockHash,
                    publisher: msg.sender,
                    reportedAt: uint64(block.timestamp)
                })
            );
            emit Equivocation(consortiumChainId, blockNumber, existing.blockHash, blockHash, msg.sender);
            return true;
        }

        uint64[] storage hs = _heights[consortiumChainId];
        require(hs.length == 0 || blockNumber > hs[hs.length - 1], "Checkpoints must be increasing");

        _checkpoints[consortiumChainId][blockNumber] = Checkpoint({
            blockNumber: blockNumber,
            blockHash: blockHash,
            stateRoot: stateRoot,
            validatorSetHash: validatorSetHash,
            publisher: msg.sender,
            anchoredAt: uint64(block.timestamp)
        });
        hs.push(blockNumber);
        emit CheckpointAnchored(consortiumChainId, blockNumber, blockHash, stateRoot, validatorSetHash, msg.sender);
        return false;
    }

    // ------------------------------------------------------------------ views
    function checkpointCount(uint256 consortiumChainId) external view returns (uint256) {
        return _heights[consortiumChainId].length;
    }

    function heightAt(uint256 consortiumChainId, uint256 i) external view returns (uint64) {
        return _heights[consortiumChainId][i];
    }

    function getCheckpoint(uint256 consortiumChainId, uint64 blockNumber) external view returns (Checkpoint memory) {
        return _checkpoints[consortiumChainId][blockNumber];
    }

    function latestCheckpoint(uint256 consortiumChainId) external view returns (Checkpoint memory) {
        uint64[] storage hs = _heights[consortiumChainId];
        require(hs.length > 0, "No checkpoints");
        return _checkpoints[consortiumChainId][hs[hs.length - 1]];
    }

    /// @notice Latest `limit` checkpoints, newest first.
    function recentCheckpoints(uint256 consortiumChainId, uint256 limit) external view returns (Checkpoint[] memory out) {
        uint64[] storage hs = _heights[consortiumChainId];
        uint256 n = hs.length < limit ? hs.length : limit;
        out = new Checkpoint[](n);
        for (uint256 i = 0; i < n; i++) out[i] = _checkpoints[consortiumChainId][hs[hs.length - 1 - i]];
    }

    function equivocationCount() external view returns (uint256) {
        return _equivocations.length;
    }

    function getEquivocation(uint256 i) external view returns (EquivocationRecord memory) {
        return _equivocations[i];
    }
}
