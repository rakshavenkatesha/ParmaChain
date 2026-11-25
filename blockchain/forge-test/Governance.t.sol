// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../contracts/Governance.sol";
import "./Base.sol";

contract Counter {
    uint256 public value;
    address public immutable gov;

    constructor(address _gov) {
        gov = _gov;
    }

    function increment() external {
        require(msg.sender == gov, "only governance");
        value++;
    }
}

/// @dev Random proposals, approvals and execution attempts by signers and outsiders.
contract GovHandler is Base {
    Governance public gov;
    Counter public counter;
    address[] public actors; // 5 signers + 2 outsiders
    uint256 public successfulExecutions;

    constructor(Governance _gov, Counter _counter, address[] memory _actors) {
        gov = _gov;
        counter = _counter;
        actors = _actors;
    }

    function propose(uint256 who) external {
        vm.prank(actors[who % actors.length]);
        try gov.propose(address(counter), abi.encodeCall(Counter.increment, ()), "inc") {} catch {}
    }

    function approve(uint256 who, uint256 id) external {
        uint256 n = gov.proposalCount();
        if (n == 0) return;
        vm.prank(actors[who % actors.length]);
        try gov.approve(id % n) {} catch {}
    }

    function execute(uint256 who, uint256 id) external {
        uint256 n = gov.proposalCount();
        if (n == 0) return;
        vm.prank(actors[who % actors.length]);
        try gov.execute(id % n) {
            successfulExecutions++;
        } catch {}
    }
}

contract GovernanceTest is Base {
    Governance gov;
    Counter counter;
    GovHandler handler;
    address[] signers;
    uint16 constant THRESHOLD = 3;

    function setUp() public {
        for (uint160 i = 1; i <= 5; i++) signers.push(address(0x3000 + i));
        gov = new Governance(signers, THRESHOLD);
        counter = new Counter(address(gov));
        address[] memory actors = new address[](7);
        for (uint256 i = 0; i < 5; i++) actors[i] = signers[i];
        actors[5] = address(0x4001);
        actors[6] = address(0x4002);
        handler = new GovHandler(gov, counter, actors);
        _targets.push(address(handler));
        bytes4[] memory sel = new bytes4[](3);
        sel[0] = GovHandler.propose.selector;
        sel[1] = GovHandler.approve.selector;
        sel[2] = GovHandler.execute.selector;
        _targetSelectors.push(FuzzSelector(address(handler), sel));
    }

    /// @notice Execution succeeds iff at least THRESHOLD distinct signers approved.
    function testFuzz_thresholdEnforced(uint8 mask) public {
        vm.prank(signers[0]);
        uint256 id = gov.propose(address(counter), abi.encodeCall(Counter.increment, ()), "inc");
        uint256 approvals = 1;
        for (uint256 j = 1; j < 5; j++) {
            if ((mask >> j) & 1 == 1) {
                vm.prank(signers[j]);
                gov.approve(id);
                approvals++;
            }
        }
        (bool ok, ) = address(gov).call(abi.encodeCall(Governance.execute, (id)));
        require(ok == (approvals >= THRESHOLD), "threshold not enforced");
        require(counter.value() == (ok ? 1 : 0), "side effect mismatch");
    }

    /// @notice Every executed proposal had enough approvals, and nothing executed twice.
    function invariant_noExecutionBelowThreshold() public view {
        uint256 n = gov.proposalCount();
        uint256 executed;
        for (uint256 i = 0; i < n; i++) {
            Governance.Proposal memory p = gov.getProposal(i);
            if (p.executed) {
                executed++;
                require(p.approvals >= THRESHOLD, "executed below threshold");
            }
        }
        require(executed == counter.value(), "executions != side effects");
        require(executed == handler.successfulExecutions(), "double execution");
    }

    /// @notice Outsiders can never propose or approve.
    function testFuzz_outsiderCannotApprove(address outsider) public {
        for (uint256 i = 0; i < 5; i++) vm.assume(outsider != signers[i]);
        vm.prank(signers[0]);
        uint256 id = gov.propose(address(counter), abi.encodeCall(Counter.increment, ()), "inc");
        vm.prank(outsider);
        (bool ok, ) = address(gov).call(abi.encodeCall(Governance.approve, (id)));
        require(!ok, "outsider approved");
    }
}
