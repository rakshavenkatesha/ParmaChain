// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Governance
 * @notice M-of-N multisig of regulator officers. High-impact actions - regulator-initiated recalls,
 *         releasing a quarantine, changing the QBFT validator set, suspending members - must be
 *         proposed by one officer and approved by `threshold` officers before anyone can execute
 *         them. This removes the "single regulator key" point of trust.
 *
 *         Proposals are generic (target, calldata) so the same mechanism governs every contract.
 */
contract Governance {
    struct Proposal {
        address target;
        bytes data;
        string description;
        address proposer;
        uint64 createdAt;
        uint16 approvals;
        bool executed;
        bool cancelled;
    }

    address[] public signers;
    mapping(address => bool) public isSigner;
    uint16 public threshold;

    Proposal[] private _proposals;
    mapping(uint256 => mapping(address => bool)) public approvedBy;

    event ProposalCreated(uint256 indexed id, address indexed proposer, address indexed target, string description);
    event ProposalApproved(uint256 indexed id, address indexed signer, uint16 approvals);
    event ProposalExecuted(uint256 indexed id, address indexed executor);
    event ProposalCancelled(uint256 indexed id, address indexed by);
    event SignersChanged(address[] signers, uint16 threshold);

    modifier onlySigner() {
        require(isSigner[msg.sender], "Not a governance signer");
        _;
    }

    modifier onlySelf() {
        require(msg.sender == address(this), "Only via a passed proposal");
        _;
    }

    constructor(address[] memory _signers, uint16 _threshold) {
        _setSigners(_signers, _threshold);
    }

    function _setSigners(address[] memory _signers, uint16 _threshold) internal {
        require(_signers.length > 0 && _threshold > 0 && _threshold <= _signers.length, "Invalid threshold");
        for (uint256 i = 0; i < signers.length; i++) isSigner[signers[i]] = false;
        delete signers;
        for (uint256 i = 0; i < _signers.length; i++) {
            require(_signers[i] != address(0) && !isSigner[_signers[i]], "Bad or duplicate signer");
            isSigner[_signers[i]] = true;
            signers.push(_signers[i]);
        }
        threshold = _threshold;
        emit SignersChanged(_signers, _threshold);
    }

    /// @notice Membership of the multisig itself can only change through the multisig.
    function setSigners(address[] calldata _signers, uint16 _threshold) external onlySelf {
        _setSigners(_signers, _threshold);
    }

    /// @notice Create a proposal; the proposer's approval is counted immediately.
    function propose(address target, bytes calldata data, string calldata description) external onlySigner returns (uint256 id) {
        require(target != address(0), "Zero target");
        id = _proposals.length;
        _proposals.push(
            Proposal({
                target: target,
                data: data,
                description: description,
                proposer: msg.sender,
                createdAt: uint64(block.timestamp),
                approvals: 0,
                executed: false,
                cancelled: false
            })
        );
        emit ProposalCreated(id, msg.sender, target, description);
        _approve(id);
    }

    function approve(uint256 id) external onlySigner {
        _approve(id);
    }

    function _approve(uint256 id) internal {
        Proposal storage p = _proposals[id];
        require(!p.executed && !p.cancelled, "Proposal closed");
        require(!approvedBy[id][msg.sender], "Already approved");
        approvedBy[id][msg.sender] = true;
        p.approvals += 1;
        emit ProposalApproved(id, msg.sender, p.approvals);
    }

    /// @notice Anyone may trigger execution once the threshold is met.
    function execute(uint256 id) external returns (bytes memory result) {
        Proposal storage p = _proposals[id];
        require(!p.executed && !p.cancelled, "Proposal closed");
        require(p.approvals >= threshold, "Not enough approvals");
        p.executed = true;
        (bool ok, bytes memory ret) = p.target.call(p.data);
        if (!ok) {
            // bubble up the target's revert reason
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        emit ProposalExecuted(id, msg.sender);
        return ret;
    }

    function cancel(uint256 id) external {
        Proposal storage p = _proposals[id];
        require(msg.sender == p.proposer, "Only the proposer can cancel");
        require(!p.executed && !p.cancelled, "Proposal closed");
        p.cancelled = true;
        emit ProposalCancelled(id, msg.sender);
    }

    // ------------------------------------------------------------------ views
    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        return _proposals[id];
    }

    function getSigners() external view returns (address[] memory) {
        return signers;
    }
}
