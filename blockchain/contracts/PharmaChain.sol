// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./AccessRegistry.sol";

/**
 * @title PharmaChain (v3)
 * @notice Clone-resistant, unit-level pharmaceutical traceability.
 *
 *  1. Two-part labels. Every pack carries a VISIBLE QR (lot, index, publicTag) and a HIDDEN
 *     scratch-off code h. Only commit(h) = H(lot, index, h) is part of the pack's Merkle leaf.
 *     Anyone can check a pack with the visible part; dispensing requires the hidden code, so a
 *     copier who only photographed the visible label can never dispense - the genuine pack
 *     always wins the race (fixes the "first presentation wins" weakness of v2).
 *  2. Packaging hierarchy case -> carton -> pack (EU FMD / DSCSA aggregation). Pack leaves form a
 *     full binary tree per carton (packsPerCarton is a power of two, zero-padded); carton leaves
 *     form a tree per case; case leaves form the lot tree. Aggregate leaves bind their index.
 *       - a distributor accepts a shipment by scanning a handful of case/carton labels;
 *       - a pharmacy dispenses many packs of one carton in one tx via a Merkle MULTIPROOF and a
 *         single bitmap-word write.
 *  3. One-time decommissioning bitmap with non-reverting evidence (clone / forgery / diversion).
 *  4. Returns of unopened packs (regulator-approved un-dispense).
 *  5. Rules as code: route policy, two-phase handshake, expiry, lot-wide recall, quarantine.
 *     Regulator recalls and quarantine releases require the Governance multisig.
 *  6. Private lots: dispensing only through the zero-knowledge module (PrivateDispenser),
 *     which proves membership + range and spends a nullifier without revealing the pack.
 */
contract PharmaChain {
    // ------------------------------------------------------------------ types
    enum Status {
        None,
        Manufactured,
        InTransit,
        Received,
        Depleted,
        Quarantined,
        Recalled
    }

    enum DispenseResult {
        Dispensed,
        InvalidProof,
        AlreadyDispensed,
        Diverted
    }

    uint8 internal constant LEVEL_CARTON = 1;
    uint8 internal constant LEVEL_CASE = 2;

    struct RegisterParams {
        string batchId;
        string drugName;
        string productCode;
        uint32 quantity;
        uint64 productionDate;
        uint64 expiryDate;
        int16 minTempDeci;
        int16 maxTempDeci;
        bytes32 unitRoot; // hierarchical Merkle root over two-part pack leaves
        uint16 packsPerCarton; // power of two, <= 256
        uint16 cartonsPerCase;
        bytes32 zkRoot; // Poseidon root for private (ZK) dispensing; 0 = public lot
    }

    struct Batch {
        bytes32 originKey;
        bytes32 parentKey;
        bytes32 unitRoot;
        bytes32 zkRoot;
        address manufacturer;
        address currentOwner;
        address pendingOwner;
        uint32 unitStart;
        uint32 unitEnd;
        uint32 dispensed;
        uint32 lotSize;
        uint16 packsPerCarton;
        uint16 cartonsPerCase;
        uint64 productionDate;
        uint64 expiryDate;
        uint64 createdAt;
        int16 minTempDeci;
        int16 maxTempDeci;
        Status status;
        bool quarantined;
        bool exists;
        string batchId;
        string drugName;
        string productCode;
    }

    struct BatchView {
        Batch batch;
        Status effectiveStatus;
        bool recalled;
        bool expired;
        uint32 quantity;
        uint32 remaining;
    }

    /// @dev What the pharmacist presents for one pack: visible tag from the QR + scratched code.
    struct UnitClaim {
        uint32 index;
        bytes32 publicTag;
        bytes10 hiddenCode;
    }

    /// @dev Path pack -> carton root -> case root -> lot root.
    struct UnitProof {
        bytes32[] pack;
        bytes32[] carton;
        bytes32[] kase;
    }

    /// @dev One aggregate label scanned on receipt (a carton or a whole case).
    struct AggregateScan {
        uint8 level; // 1 = carton, 2 = case
        uint32 index;
        bytes32 root;
        bytes32[] up1; // carton -> case (cartons only)
        bytes32[] up2; // case -> lot
    }

    // ------------------------------------------------------------------ storage
    uint32 public constant MAX_UNITS_PER_LOT = 1_000_000;

    AccessRegistry public immutable registry;
    address public immutable governance;
    address public immutable deployer;
    address public privateDispenser;

    mapping(bytes32 => Batch) private _batches;
    bytes32[] private _batchKeys;
    mapping(bytes32 => address[]) private _custody;
    mapping(bytes32 => uint64[]) private _custodyTimes;
    mapping(bytes32 => bytes32[]) private _children;
    mapping(bytes32 => bool) private _recalled;
    mapping(bytes32 => mapping(uint256 => uint256)) private _dispensedBitmap;
    mapping(bytes32 => mapping(uint256 => address)) public returnRequestedBy;

    // ------------------------------------------------------------------ events
    event BatchRegistered(bytes32 indexed key, string batchId, address indexed manufacturer, uint32 quantity, bytes32 unitRoot, uint256 timestamp);
    event TransferInitiated(bytes32 indexed key, string batchId, address indexed from, address indexed to, uint256 timestamp);
    event TransferCancelled(bytes32 indexed key, string batchId, address indexed by, uint256 timestamp);
    event ShipmentAccepted(bytes32 indexed key, string batchId, address indexed owner, uint256 timestamp);
    event AggregationVerified(bytes32 indexed key, string batchId, uint256 scans, uint32 unitStart, uint32 unitEnd);
    event BatchSplit(bytes32 indexed parentKey, bytes32 indexed childKey, string parentId, string childId, uint32 unitStart, uint32 unitEnd, uint256 timestamp);
    event UnitDispensed(bytes32 indexed originKey, bytes32 indexed holdingKey, uint256 indexed unitIndex, address pharmacy, uint256 timestamp);
    event CartonDispensed(bytes32 indexed holdingKey, uint256 indexed cartonIndex, uint256 dispensedCount, uint256 timestamp);
    event PrivateUnitDispensed(bytes32 indexed holdingKey, bytes32 indexed nullifier, address pharmacy, uint256 timestamp);
    event CloneDetected(bytes32 indexed originKey, bytes32 indexed holdingKey, uint256 indexed unitIndex, address reporter, uint256 timestamp);
    event CounterfeitDetected(bytes32 indexed originKey, bytes32 indexed holdingKey, uint256 indexed unitIndex, address reporter, uint256 timestamp);
    event DiversionDetected(bytes32 indexed originKey, bytes32 indexed holdingKey, uint256 indexed unitIndex, address reporter, uint256 timestamp);
    event ReturnRequested(bytes32 indexed holdingKey, uint256 indexed unitIndex, address indexed pharmacy, string reason, uint256 timestamp);
    event UnitReturned(bytes32 indexed holdingKey, uint256 indexed unitIndex, address indexed approvedBy, uint256 timestamp);
    event BatchRecalled(bytes32 indexed originKey, string batchId, address indexed by, string reason, uint256 timestamp);
    event BatchQuarantined(bytes32 indexed key, string batchId, address indexed by, string reason, uint256 timestamp);
    event QuarantineReleased(bytes32 indexed key, string batchId, address indexed by, uint256 timestamp);

    // ------------------------------------------------------------------ setup
    constructor(AccessRegistry _registry, address _governance) {
        require(address(_registry) != address(0) && _governance != address(0), "Zero address"); // slither: missing-zero-check
        registry = _registry;
        governance = _governance;
        deployer = msg.sender;
    }

    /// @notice One-time wiring of the zero-knowledge dispensing module.
    function setPrivateDispenser(address module) external {
        require(msg.sender == deployer, "Only deployer");
        require(privateDispenser == address(0), "Already set");
        require(module != address(0), "Zero module"); // slither: missing-zero-check
        privateDispenser = module;
    }

    modifier onlyRole(AccessRegistry.Role role) {
        require(registry.activeRoleOf(msg.sender) == role, "Unauthorised role");
        _;
    }

    function keyOf(string memory batchId) public pure returns (bytes32) {
        return keccak256(bytes(batchId));
    }

    function _load(string memory batchId) internal view returns (bytes32 key, Batch storage b) {
        key = keyOf(batchId);
        b = _batches[key];
        require(b.exists, "Batch does not exist");
    }

    function _requireOperable(Batch storage b) internal view {
        require(!_recalled[b.originKey], "Batch lot is recalled");
        require(!b.quarantined, "Batch is quarantined");
        require(block.timestamp < b.expiryDate, "Batch has expired");
    }

    function _isAllowedRoute(AccessRegistry.Role from, AccessRegistry.Role to) internal pure returns (bool) {
        if (from == AccessRegistry.Role.Manufacturer) return to == AccessRegistry.Role.Distributor;
        if (from == AccessRegistry.Role.Distributor) return to == AccessRegistry.Role.Distributor || to == AccessRegistry.Role.Pharmacy;
        return false;
    }

    function _pushCustody(bytes32 key, address who) internal {
        _custody[key].push(who);
        _custodyTimes[key].push(uint64(block.timestamp));
    }

    // ------------------------------------------------------------------ leaf encodings
    function hiddenCommitment(bytes32 originKey, uint256 index, bytes10 hiddenCode) public pure returns (bytes32) {
        return keccak256(abi.encode(originKey, index, hiddenCode));
    }

    function packLeaf(bytes32 originKey, uint256 index, bytes32 publicTag, bytes32 commitment) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(originKey, index, publicTag, commitment))));
    }

    function aggregateLeaf(bytes32 originKey, uint8 level, uint256 index, bytes32 root) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(originKey, level, index, root))));
    }

    /// @dev carton root -> lot root, binding carton and case indices.
    function _lotRootFromCarton(Batch storage b, uint256 cartonIdx, bytes32 cartonRoot, bytes32[] calldata cartonProof, bytes32[] calldata caseProof)
        internal
        view
        returns (bytes32)
    {
        uint256 caseIdx = cartonIdx / b.cartonsPerCase;
        bytes32 caseRoot = MerkleProof.processProofCalldata(cartonProof, aggregateLeaf(b.originKey, LEVEL_CARTON, cartonIdx, cartonRoot));
        return MerkleProof.processProofCalldata(caseProof, aggregateLeaf(b.originKey, LEVEL_CASE, caseIdx, caseRoot));
    }

    function _packAuthentic(Batch storage b, uint256 index, bytes32 leaf, UnitProof calldata p) internal view returns (bool) {
        if (index >= b.lotSize) return false;
        bytes32 cartonRoot = MerkleProof.processProofCalldata(p.pack, leaf);
        return _lotRootFromCarton(b, index / b.packsPerCarton, cartonRoot, p.carton, p.kase) == b.unitRoot;
    }

    // ------------------------------------------------------------------ manufacturer
    function registerBatch(RegisterParams calldata p) external onlyRole(AccessRegistry.Role.Manufacturer) {
        require(bytes(p.batchId).length > 0, "Batch ID cannot be empty");
        bytes32 key = keyOf(p.batchId);
        require(!_batches[key].exists, "Batch ID already exists");
        require(p.quantity > 0 && p.quantity <= MAX_UNITS_PER_LOT, "Invalid quantity");
        require(p.expiryDate > p.productionDate, "Expiry date must be after production date");
        require(p.expiryDate > block.timestamp, "Batch already expired");
        require(p.minTempDeci < p.maxTempDeci, "Invalid temperature range");
        require(p.unitRoot != bytes32(0), "Unit Merkle root required");
        uint16 ppc = p.packsPerCarton;
        require(ppc > 0 && ppc <= 256 && (ppc & (ppc - 1)) == 0, "packsPerCarton must be a power of two <= 256");
        require(p.cartonsPerCase > 0, "cartonsPerCase required");

        Batch storage b = _batches[key];
        b.originKey = key;
        b.unitRoot = p.unitRoot;
        b.zkRoot = p.zkRoot;
        b.manufacturer = msg.sender;
        b.currentOwner = msg.sender;
        b.unitEnd = p.quantity;
        b.lotSize = p.quantity;
        b.packsPerCarton = ppc;
        b.cartonsPerCase = p.cartonsPerCase;
        b.productionDate = p.productionDate;
        b.expiryDate = p.expiryDate;
        b.createdAt = uint64(block.timestamp);
        b.minTempDeci = p.minTempDeci;
        b.maxTempDeci = p.maxTempDeci;
        b.status = Status.Manufactured;
        b.exists = true;
        b.batchId = p.batchId;
        b.drugName = p.drugName;
        b.productCode = p.productCode;

        _batchKeys.push(key);
        _pushCustody(key, msg.sender);
        emit BatchRegistered(key, p.batchId, msg.sender, p.quantity, p.unitRoot, block.timestamp);
    }

    // ------------------------------------------------------------------ custody
    function transferOwnership(string calldata batchId, address to) external {
        (bytes32 key, Batch storage b) = _load(batchId);
        require(b.currentOwner == msg.sender, "Caller is not the current owner");
        require(b.status == Status.Manufactured || b.status == Status.Received, "Batch not transferable in current state");
        require(b.dispensed == 0, "Partially dispensed batches cannot be shipped");
        _requireOperable(b);
        require(to != address(0) && to != msg.sender, "Invalid recipient");
        require(_isAllowedRoute(registry.activeRoleOf(msg.sender), registry.activeRoleOf(to)), "Route not permitted by supply-chain policy");
        b.pendingOwner = to;
        b.status = Status.InTransit;
        emit TransferInitiated(key, batchId, msg.sender, to, block.timestamp);
    }

    function cancelTransfer(string calldata batchId) external {
        (bytes32 key, Batch storage b) = _load(batchId);
        require(b.currentOwner == msg.sender, "Caller is not the current owner");
        require(b.status == Status.InTransit, "Batch is not in transit");
        b.pendingOwner = address(0);
        b.status = (msg.sender == b.manufacturer) ? Status.Manufactured : Status.Received;
        emit TransferCancelled(key, batchId, msg.sender, block.timestamp);
    }

    function _accept(bytes32 key, Batch storage b, string calldata batchId) internal {
        require(b.status == Status.InTransit, "Batch is not in transit");
        require(b.pendingOwner == msg.sender, "Caller is not the designated recipient");
        require(registry.activeRoleOf(msg.sender) != AccessRegistry.Role.None, "Recipient no longer authorised");
        _requireOperable(b);
        b.currentOwner = msg.sender;
        b.pendingOwner = address(0);
        b.status = Status.Received;
        _pushCustody(key, msg.sender);
        emit ShipmentAccepted(key, batchId, msg.sender, block.timestamp);
    }

    function acceptShipment(string calldata batchId) external {
        (bytes32 key, Batch storage b) = _load(batchId);
        _accept(key, b, batchId);
    }

    /**
     * @notice Accept a shipment by scanning aggregate (case / carton) labels instead of every pack.
     *         Each scanned aggregate is proven to belong to the lot, and together the scans must
     *         cover EXACTLY this shipment's unit range, in order.
     */
    function acceptWithAggregation(string calldata batchId, AggregateScan[] calldata scans) external {
        (bytes32 key, Batch storage b) = _load(batchId);
        require(scans.length > 0, "No scans");
        uint256 cursor = b.unitStart;
        uint256 caseSize = uint256(b.packsPerCarton) * b.cartonsPerCase;
        for (uint256 i = 0; i < scans.length; i++) {
            AggregateScan calldata s = scans[i];
            uint256 start;
            uint256 size;
            bytes32 lotRoot;
            if (s.level == LEVEL_CASE) {
                lotRoot = MerkleProof.processProofCalldata(s.up2, aggregateLeaf(b.originKey, LEVEL_CASE, s.index, s.root));
                start = uint256(s.index) * caseSize;
                size = caseSize;
            } else if (s.level == LEVEL_CARTON) {
                lotRoot = _lotRootFromCarton(b, s.index, s.root, s.up1, s.up2);
                start = uint256(s.index) * b.packsPerCarton;
                size = b.packsPerCarton;
            } else {
                revert("Unknown aggregation level");
            }
            require(lotRoot == b.unitRoot, "Aggregate label not part of this lot");
            require(start == cursor, "Scans must be contiguous and in order");
            uint256 end = start + size;
            if (end > b.lotSize) end = b.lotSize;
            cursor = end;
        }
        require(cursor == b.unitEnd, "Scans do not cover the shipment exactly");
        emit AggregationVerified(key, batchId, scans.length, b.unitStart, b.unitEnd);
        _accept(key, b, batchId);
    }

    // ------------------------------------------------------------------ split
    function splitBatch(string calldata parentId, string calldata childId, uint32 quantity) external {
        (bytes32 parentKey, Batch storage parent) = _load(parentId);
        require(parent.currentOwner == msg.sender, "Caller is not the current owner");
        require(parent.status == Status.Manufactured || parent.status == Status.Received, "Batch not splittable in current state");
        AccessRegistry.Role role = registry.activeRoleOf(msg.sender);
        require(role == AccessRegistry.Role.Manufacturer || role == AccessRegistry.Role.Distributor, "Only manufacturers/distributors split");
        _requireOperable(parent);
        require(bytes(childId).length > 0, "Child ID cannot be empty");
        bytes32 childKey = keyOf(childId);
        require(!_batches[childKey].exists, "Child ID already exists");
        uint32 held = parent.unitEnd - parent.unitStart;
        require(quantity > 0 && quantity < held, "Split quantity must be between 1 and held-1");

        uint32 childStart = parent.unitEnd - quantity;
        uint32 childEnd = parent.unitEnd;
        parent.unitEnd = childStart;

        Batch storage c = _batches[childKey];
        c.originKey = parent.originKey;
        c.parentKey = parentKey;
        c.unitRoot = parent.unitRoot;
        c.zkRoot = parent.zkRoot;
        c.manufacturer = parent.manufacturer;
        c.currentOwner = msg.sender;
        c.unitStart = childStart;
        c.unitEnd = childEnd;
        c.lotSize = parent.lotSize;
        c.packsPerCarton = parent.packsPerCarton;
        c.cartonsPerCase = parent.cartonsPerCase;
        c.productionDate = parent.productionDate;
        c.expiryDate = parent.expiryDate;
        c.createdAt = uint64(block.timestamp);
        c.minTempDeci = parent.minTempDeci;
        c.maxTempDeci = parent.maxTempDeci;
        c.status = parent.status;
        c.exists = true;
        c.batchId = childId;
        c.drugName = parent.drugName;
        c.productCode = parent.productCode;

        address[] storage pc = _custody[parentKey];
        uint64[] storage pt = _custodyTimes[parentKey];
        for (uint256 i = 0; i < pc.length; i++) {
            _custody[childKey].push(pc[i]);
            _custodyTimes[childKey].push(pt[i]);
        }
        _children[parentKey].push(childKey);
        _batchKeys.push(childKey);
        emit BatchSplit(parentKey, childKey, parentId, childId, childStart, childEnd, block.timestamp);
    }

    // ------------------------------------------------------------------ dispensing
    function _shelf(string calldata holdingBatchId) internal view returns (bytes32 key, Batch storage b) {
        (key, b) = _load(holdingBatchId);
        require(b.currentOwner == msg.sender, "Caller is not the current owner");
        require(b.status == Status.Received, "Batch is not on the pharmacy shelf");
        _requireOperable(b);
    }

    /**
     * @notice Dispense one pack: visible tag + scratched hidden code + hierarchical proof.
     *         Attack signals are recorded (event + return code) instead of reverting.
     */
    function decommissionUnit(string calldata holdingBatchId, UnitClaim calldata c, UnitProof calldata p)
        external
        onlyRole(AccessRegistry.Role.Pharmacy)
        returns (DispenseResult)
    {
        (bytes32 key, Batch storage b) = _shelf(holdingBatchId);
        require(b.zkRoot == bytes32(0), "Private lot: use zero-knowledge dispensing");
        bytes32 origin = b.originKey;
        bytes32 leaf = packLeaf(origin, c.index, c.publicTag, hiddenCommitment(origin, c.index, c.hiddenCode));

        if (!_packAuthentic(b, c.index, leaf, p)) {
            // forged label, or a copy of the visible label without the genuine scratch code
            emit CounterfeitDetected(origin, key, c.index, msg.sender, block.timestamp);
            return DispenseResult.InvalidProof;
        }
        uint256 word = c.index >> 8;
        uint256 mask = uint256(1) << (c.index & 0xff);
        uint256 bits = _dispensedBitmap[origin][word];
        if (bits & mask != 0) {
            emit CloneDetected(origin, key, c.index, msg.sender, block.timestamp);
            return DispenseResult.AlreadyDispensed;
        }
        if (c.index < b.unitStart || c.index >= b.unitEnd) {
            emit DiversionDetected(origin, key, c.index, msg.sender, block.timestamp);
            return DispenseResult.Diverted;
        }
        _dispensedBitmap[origin][word] = bits | mask;
        b.dispensed += 1;
        if (b.dispensed == b.unitEnd - b.unitStart) b.status = Status.Depleted;
        emit UnitDispensed(origin, key, c.index, msg.sender, block.timestamp);
        return DispenseResult.Dispensed;
    }

    /**
     * @notice Dispense several packs of ONE carton with a single Merkle multiproof.
     *         Claims must be sorted by ascending index (the order the multiproof was built in).
     *         A carton (<= 256 packs, power-of-two aligned) lives in one bitmap word, so the whole
     *         batch costs one bitmap SLOAD/SSTORE. Invalid proofs revert (use decommissionUnit for
     *         forensic single scans); clones / diversions inside the batch are recorded and skipped.
     */
    function decommissionCarton(
        string calldata holdingBatchId,
        uint32 cartonIndex,
        UnitClaim[] calldata claims,
        bytes32[] calldata multiProof,
        bool[] calldata proofFlags,
        bytes32[] calldata cartonProof,
        bytes32[] calldata caseProof
    ) external onlyRole(AccessRegistry.Role.Pharmacy) returns (uint256 dispensedCount) {
        (bytes32 key, Batch storage b) = _shelf(holdingBatchId);
        require(b.zkRoot == bytes32(0), "Private lot: use zero-knowledge dispensing");
        require(claims.length > 0, "No claims");
        bytes32 origin = b.originKey;
        uint256 ppc = b.packsPerCarton;

        bytes32[] memory leaves = new bytes32[](claims.length);
        for (uint256 i = 0; i < claims.length; i++) {
            UnitClaim calldata c = claims[i];
            require(c.index / ppc == cartonIndex, "Claim outside the carton");
            require(i == 0 || c.index > claims[i - 1].index, "Claims must be strictly ascending");
            leaves[i] = packLeaf(origin, c.index, c.publicTag, hiddenCommitment(origin, c.index, c.hiddenCode));
        }
        bytes32 cartonRoot = MerkleProof.processMultiProofCalldata(multiProof, proofFlags, leaves);
        require(_lotRootFromCarton(b, cartonIndex, cartonRoot, cartonProof, caseProof) == b.unitRoot, "Invalid carton multiproof");

        uint256 word = (uint256(cartonIndex) * ppc) >> 8;
        uint256 bits = _dispensedBitmap[origin][word];
        for (uint256 i = 0; i < claims.length; i++) {
            uint256 idx = claims[i].index;
            uint256 mask = uint256(1) << (idx & 0xff);
            if (bits & mask != 0) {
                emit CloneDetected(origin, key, idx, msg.sender, block.timestamp);
                continue;
            }
            if (idx < b.unitStart || idx >= b.unitEnd) {
                emit DiversionDetected(origin, key, idx, msg.sender, block.timestamp);
                continue;
            }
            bits |= mask;
            dispensedCount++;
            emit UnitDispensed(origin, key, idx, msg.sender, block.timestamp);
        }
        _dispensedBitmap[origin][word] = bits;
        b.dispensed += uint32(dispensedCount);
        if (b.dispensed == b.unitEnd - b.unitStart) b.status = Status.Depleted;
        emit CartonDispensed(key, cartonIndex, dispensedCount, block.timestamp);
    }

    /// @notice Hook for the zero-knowledge module: counts a privately dispensed unit.
    function recordPrivateDispense(string calldata holdingBatchId, address pharmacy, bytes32 nullifier) external {
        require(msg.sender == privateDispenser && privateDispenser != address(0), "Only the private dispenser");
        (bytes32 key, Batch storage b) = _load(holdingBatchId);
        require(b.zkRoot != bytes32(0), "Not a private lot");
        require(b.currentOwner == pharmacy && b.status == Status.Received, "Pharmacy does not hold this shelf stock");
        _requireOperable(b);
        b.dispensed += 1;
        if (b.dispensed == b.unitEnd - b.unitStart) b.status = Status.Depleted;
        emit PrivateUnitDispensed(key, nullifier, pharmacy, block.timestamp);
    }

    // ------------------------------------------------------------------ returns
    /// @notice Pharmacy asks to take back an unopened, already dispensed pack.
    function requestReturn(string calldata holdingBatchId, uint32 index, string calldata reason) external onlyRole(AccessRegistry.Role.Pharmacy) {
        (bytes32 key, Batch storage b) = _load(holdingBatchId);
        require(b.currentOwner == msg.sender, "Caller is not the current owner");
        require(b.zkRoot == bytes32(0), "Returns are not supported for private lots");
        require(index >= b.unitStart && index < b.unitEnd, "Unit is not from this shipment");
        require(isDispensed(b.originKey, index), "Unit was never dispensed");
        require(returnRequestedBy[key][index] == address(0), "Return already requested");
        returnRequestedBy[key][index] = msg.sender;
        emit ReturnRequested(key, index, msg.sender, reason, block.timestamp);
    }

    /// @notice Regulator approves the return: the unit's bit is cleared and it is back on the shelf.
    function approveReturn(string calldata holdingBatchId, uint32 index) external onlyRole(AccessRegistry.Role.Regulator) {
        (bytes32 key, Batch storage b) = _load(holdingBatchId);
        require(returnRequestedBy[key][index] != address(0), "No pending return");
        require(!_recalled[b.originKey], "Recalled lots cannot be restocked");
        delete returnRequestedBy[key][index];
        _dispensedBitmap[b.originKey][index >> 8] &= ~(uint256(1) << (index & 0xff));
        b.dispensed -= 1;
        if (b.status == Status.Depleted) b.status = Status.Received;
        emit UnitReturned(key, index, msg.sender, block.timestamp);
    }

    // ------------------------------------------------------------------ safety
    /// @notice A manufacturer may recall its own lot; a regulator recall needs the multisig.
    function recallBatch(string calldata batchId, string calldata reason) external {
        (, Batch storage b) = _load(batchId);
        require(msg.sender == b.manufacturer || msg.sender == governance, "Only manufacturer or governance multisig");
        require(!_recalled[b.originKey], "Batch lot is already recalled");
        _recalled[b.originKey] = true;
        emit BatchRecalled(b.originKey, batchId, msg.sender, reason, block.timestamp);
    }

    function quarantineBatch(string calldata batchId, string calldata reason) external {
        AccessRegistry.Role role = registry.activeRoleOf(msg.sender);
        require(role == AccessRegistry.Role.Regulator || role == AccessRegistry.Role.Oracle, "Only regulator or oracle can quarantine");
        (bytes32 key, Batch storage b) = _load(batchId);
        require(!b.quarantined, "Already quarantined");
        b.quarantined = true;
        emit BatchQuarantined(key, batchId, msg.sender, reason, block.timestamp);
    }

    /// @notice Releasing a quarantine is high-impact: only the Governance multisig.
    function releaseQuarantine(string calldata batchId) external {
        require(msg.sender == governance, "Only governance multisig");
        (bytes32 key, Batch storage b) = _load(batchId);
        require(b.quarantined, "Not quarantined");
        b.quarantined = false;
        emit QuarantineReleased(key, batchId, msg.sender, block.timestamp);
    }

    // ------------------------------------------------------------------ views
    function _view(bytes32 key) internal view returns (BatchView memory v) {
        Batch storage b = _batches[key];
        require(b.exists, "Batch does not exist");
        v.batch = b;
        v.recalled = _recalled[b.originKey];
        v.expired = block.timestamp >= b.expiryDate;
        v.quantity = b.unitEnd - b.unitStart;
        v.remaining = v.quantity - b.dispensed;
        if (v.recalled) v.effectiveStatus = Status.Recalled;
        else if (b.quarantined) v.effectiveStatus = Status.Quarantined;
        else v.effectiveStatus = b.status;
    }

    function getBatch(string calldata batchId) external view returns (BatchView memory) {
        return _view(keyOf(batchId));
    }

    function getBatchByKey(bytes32 key) external view returns (BatchView memory) {
        return _view(key);
    }

    function getBatchHistory(string calldata batchId) external view returns (address[] memory custodyList, uint64[] memory timestampList) {
        bytes32 key = keyOf(batchId);
        require(_batches[key].exists, "Batch does not exist");
        return (_custody[key], _custodyTimes[key]);
    }

    function getChildren(string calldata batchId) external view returns (bytes32[] memory) {
        return _children[keyOf(batchId)];
    }

    function isDispensed(bytes32 originKey, uint256 index) public view returns (bool) {
        return (_dispensedBitmap[originKey][index >> 8] >> (index & 0xff)) & 1 == 1;
    }

    /**
     * @notice Consumer-facing, gas-free check of the VISIBLE label. `commitment` is the public
     *         commitment to the hidden code (served by the proof server); it reveals nothing about h.
     */
    function verifyUnit(string calldata batchId, uint256 index, bytes32 publicTag, bytes32 commitment, UnitProof calldata p)
        external
        view
        returns (bool authentic, bool dispensed, Status lotStatus, bool expired)
    {
        Batch storage b = _batches[keyOf(batchId)];
        if (!b.exists) return (false, false, Status.None, false);
        bytes32 origin = b.originKey;
        Batch storage lot = _batches[origin];
        authentic = _packAuthentic(lot, index, packLeaf(origin, index, publicTag, commitment), p);
        dispensed = authentic && isDispensed(origin, index);
        lotStatus = _recalled[origin] ? Status.Recalled : (lot.quarantined ? Status.Quarantined : lot.status);
        expired = block.timestamp >= lot.expiryDate;
    }

    function batchCount() external view returns (uint256) {
        return _batchKeys.length;
    }

    function getBatchIds(uint256 offset, uint256 limit) external view returns (string[] memory ids) {
        uint256 n = _batchKeys.length;
        if (offset >= n) return new string[](0);
        uint256 end = offset + limit > n ? n : offset + limit;
        ids = new string[](end - offset);
        for (uint256 i = offset; i < end; i++) ids[i - offset] = _batches[_batchKeys[i]].batchId;
    }

    function isRecalled(bytes32 originKey) external view returns (bool) {
        return _recalled[originKey];
    }
}
