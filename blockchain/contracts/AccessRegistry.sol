// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AccessRegistry
 * @notice On-chain identity & permission layer of the PharmaChain consortium.
 *
 * The regulator (e.g. CDSCO / FDA node) is the root of trust. Only the regulator can
 * admit organisations into the network and assign them exactly one supply-chain role.
 * Licence numbers are never stored in clear text; only keccak256(licenceNumber) is
 * anchored so that an auditor holding the paper licence can verify it.
 *
 * Roles are enforced by PharmaChain.sol - a wallet that is not registered here cannot
 * mint batches, receive shipments or dispense units, no matter what the off-chain
 * database says.
 */
contract AccessRegistry is AccessControl {
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR_ROLE");
    bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 public constant PHARMACY_ROLE = keccak256("PHARMACY_ROLE");
    /// @dev IoT gateway / cold-chain oracle allowed to push signed sensor readings.
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    enum Role {
        None,
        Manufacturer,
        Distributor,
        Pharmacy,
        Regulator,
        Oracle
    }

    struct Participant {
        Role role;
        bool active;
        uint64 registeredAt;
        bytes32 licenseHash;
        string name;
    }

    mapping(address => Participant) private _participants;
    address[] private _participantList;

    event ParticipantRegistered(
        address indexed account,
        Role indexed role,
        string name,
        bytes32 licenseHash,
        uint256 timestamp
    );
    event ParticipantSuspended(address indexed account, string reason, uint256 timestamp);
    event ParticipantReinstated(address indexed account, uint256 timestamp);

    constructor(address regulator) {
        require(regulator != address(0), "Regulator required");
        _grantRole(DEFAULT_ADMIN_ROLE, regulator);
        _grantRole(REGULATOR_ROLE, regulator);

        _setRoleAdmin(MANUFACTURER_ROLE, REGULATOR_ROLE);
        _setRoleAdmin(DISTRIBUTOR_ROLE, REGULATOR_ROLE);
        _setRoleAdmin(PHARMACY_ROLE, REGULATOR_ROLE);
        _setRoleAdmin(ORACLE_ROLE, REGULATOR_ROLE);

        _participants[regulator] = Participant({
            role: Role.Regulator,
            active: true,
            registeredAt: uint64(block.timestamp),
            licenseHash: bytes32(0),
            name: "Regulator"
        });
        _participantList.push(regulator);
        emit ParticipantRegistered(regulator, Role.Regulator, "Regulator", bytes32(0), block.timestamp);
    }

    // ------------------------------------------------------------------
    // Regulator operations
    // ------------------------------------------------------------------

    function registerParticipant(
        address account,
        Role role,
        string calldata name,
        bytes32 licenseHash
    ) external onlyRole(REGULATOR_ROLE) {
        require(account != address(0), "Zero address");
        require(
            role == Role.Manufacturer || role == Role.Distributor || role == Role.Pharmacy || role == Role.Oracle,
            "Invalid role"
        );
        require(_participants[account].role == Role.None, "Account already registered");

        _grantRole(_roleId(role), account);
        _participants[account] = Participant({
            role: role,
            active: true,
            registeredAt: uint64(block.timestamp),
            licenseHash: licenseHash,
            name: name
        });
        _participantList.push(account);

        emit ParticipantRegistered(account, role, name, licenseHash, block.timestamp);
    }

    /// @notice Suspend a participant (licence revoked, investigation...). Keeps history intact.
    function suspendParticipant(address account, string calldata reason) external onlyRole(REGULATOR_ROLE) {
        Participant storage p = _participants[account];
        require(p.role != Role.None && p.role != Role.Regulator, "Not suspendable");
        require(p.active, "Already suspended");
        p.active = false;
        _revokeRole(_roleId(p.role), account);
        emit ParticipantSuspended(account, reason, block.timestamp);
    }

    function reinstateParticipant(address account) external onlyRole(REGULATOR_ROLE) {
        Participant storage p = _participants[account];
        require(p.role != Role.None && p.role != Role.Regulator, "Not reinstatable");
        require(!p.active, "Already active");
        p.active = true;
        _grantRole(_roleId(p.role), account);
        emit ParticipantReinstated(account, block.timestamp);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Role of an account, or Role.None if unregistered OR suspended.
    function activeRoleOf(address account) external view returns (Role) {
        Participant storage p = _participants[account];
        return p.active ? p.role : Role.None;
    }

    function getParticipant(address account) external view returns (Participant memory) {
        return _participants[account];
    }

    function participantCount() external view returns (uint256) {
        return _participantList.length;
    }

    function participantAt(uint256 index) external view returns (address) {
        return _participantList[index];
    }

    function verifyLicense(address account, string calldata licenseNumber) external view returns (bool) {
        return _participants[account].licenseHash == keccak256(bytes(licenseNumber));
    }

    function _roleId(Role role) internal pure returns (bytes32) {
        if (role == Role.Manufacturer) return MANUFACTURER_ROLE;
        if (role == Role.Distributor) return DISTRIBUTOR_ROLE;
        if (role == Role.Pharmacy) return PHARMACY_ROLE;
        if (role == Role.Oracle) return ORACLE_ROLE;
        if (role == Role.Regulator) return REGULATOR_ROLE;
        revert("No role id");
    }
}
