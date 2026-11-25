// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { SD59x18, sd, exp, ln, intoInt256 } from "@prb/math/src/SD59x18.sol";
import "./AccessRegistry.sol";
import "./PharmaChain.sol";

/**
 * @title ColdChainMonitor
 * @notice Byzantine-tolerant cold-chain oracle with cumulative heat-exposure scoring.
 *
 *  - Each shipment is watched by THREE registered sensor devices. Every reading is signed inside
 *    the device (EIP-191 over chainId, this contract, shipment, sequence, temperature, time).
 *  - A reading is accepted only if at least TWO valid sensor signatures AGREE (within 1.0 degC).
 *    One faulty or tampered sensor can neither trigger nor suppress a quarantine; disagreements
 *    and outliers are recorded on-chain as evidence.
 *  - Excursions are judged by Mean Kinetic Temperature (MKT, Haynes / USP <1079>), the
 *    Arrhenius-weighted average that models cumulative thermal degradation, not by one bad reading:
 *        MKT = (dH/R) / ( -ln( (1/n) * sum exp(-dH/(R*T_i)) ) ),   dH/R = 10,000 K
 *    computed on-chain with PRBMath fixed point. A short harmless spike does not quarantine; a
 *    sustained mild excursion does. A hard limit still catches freezing / extreme heat instantly.
 */
contract ColdChainMonitor {
    using ECDSA for bytes32;

    AccessRegistry public immutable registry;
    PharmaChain public immutable pharma;

    int256 internal constant DH_OVER_R = 10_000e18; // Kelvin (dH = 83.144 kJ/mol)
    int256 internal constant T_REF = 278_150000000000000000; // 5 degC reference keeps exp() well-scaled
    int256 internal constant KELVIN = 273_150000000000000000;
    int16 public constant AGREEMENT_TOLERANCE_DECI = 10; // sensors must agree within 1.0 degC
    int16 public constant HARD_HIGH_MARGIN_DECI = 100; // max + 10 degC -> immediate breach
    int16 public constant FREEZE_MARGIN_DECI = 20; // min - 2 degC -> immediate breach (freezing)

    struct Monitor {
        address[3] sensors;
        uint64 lastSeq;
        uint32 count;
        int256 sumTerm; // SD59x18 raw: sum exp(dH/R * (1/Tref - 1/T))
        int16 lastAgreedDeci;
        int16 mktDeci;
        bool breached;
    }

    struct SignedReading {
        int16 tempDeci;
        uint64 timestamp;
        bytes signature;
    }

    mapping(address => bool) public isSensor;
    mapping(bytes32 => Monitor) private _monitors;

    event SensorRegistered(address indexed sensor, string label);
    event SensorsAssigned(bytes32 indexed key, string batchId, address[3] sensors);
    event ReadingAccepted(bytes32 indexed key, uint64 indexed seq, int16 agreedDeci, int16 mktDeci, uint8 validSignatures, uint64 timestamp);
    event SensorOutlier(bytes32 indexed key, uint64 indexed seq, address indexed sensor, int16 tempDeci);
    event SensorDisagreement(bytes32 indexed key, uint64 indexed seq, uint8 validSignatures);
    event ColdChainBreach(bytes32 indexed key, string batchId, int16 agreedDeci, int16 mktDeci, string reason);

    constructor(AccessRegistry _registry, PharmaChain _pharma) {
        registry = _registry;
        pharma = _pharma;
    }

    // ------------------------------------------------------------------ setup
    function registerSensor(address sensor, string calldata label) external {
        require(registry.activeRoleOf(msg.sender) == AccessRegistry.Role.Regulator, "Only regulator");
        require(sensor != address(0), "Zero sensor");
        isSensor[sensor] = true;
        emit SensorRegistered(sensor, label);
    }

    /// @notice The party dispatching a shipment attaches three sensors to it.
    function assignSensors(string calldata batchId, address[3] calldata sensors) external {
        PharmaChain.BatchView memory v = pharma.getBatch(batchId);
        require(msg.sender == v.batch.currentOwner, "Only the current owner");
        for (uint256 i = 0; i < 3; i++) {
            require(isSensor[sensors[i]], "Unregistered sensor");
            for (uint256 j = 0; j < i; j++) require(sensors[i] != sensors[j], "Duplicate sensor");
        }
        bytes32 key = pharma.keyOf(batchId);
        _monitors[key].sensors = sensors;
        emit SensorsAssigned(key, batchId, sensors);
    }

    // ------------------------------------------------------------------ readings
    function readingDigest(bytes32 key, uint64 seq, int16 tempDeci, uint64 timestamp) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), key, seq, tempDeci, timestamp));
    }

    /**
     * @notice Submit one sampling window, signed by the shipment's sensors. Anyone may relay it;
     *         trust comes from the device signatures, not from the relayer.
     */
    function submitReadings(string calldata batchId, uint64 seq, SignedReading[] calldata readings) external {
        bytes32 key = pharma.keyOf(batchId);
        Monitor storage m = _monitors[key];
        require(m.sensors[0] != address(0), "No sensors assigned");
        require(seq > m.lastSeq, "Stale or replayed sequence");
        m.lastSeq = seq;

        (int16[3] memory temps, address[3] memory who, uint8 n) = _validReadings(m, key, seq, readings);
        require(n >= 2, "Need at least 2 valid sensor signatures");

        (bool agreed, int16 value) = _agree(key, seq, temps, who, n);
        if (!agreed) {
            emit SensorDisagreement(key, seq, n);
            return;
        }

        m.count += 1;
        m.sumTerm += intoInt256(_arrheniusTerm(value));
        m.lastAgreedDeci = value;
        m.mktDeci = _mktDeci(m.sumTerm, m.count);
        emit ReadingAccepted(key, seq, value, m.mktDeci, n, readings[0].timestamp);

        if (!m.breached) _checkBreach(m, batchId, key, value);
    }

    function _validReadings(Monitor storage m, bytes32 key, uint64 seq, SignedReading[] calldata readings)
        internal
        view
        returns (int16[3] memory temps, address[3] memory who, uint8 n)
    {
        bool[3] memory used;
        for (uint256 i = 0; i < readings.length && n < 3; i++) {
            bytes32 digest = MessageHashUtils.toEthSignedMessageHash(readingDigest(key, seq, readings[i].tempDeci, readings[i].timestamp));
            (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, readings[i].signature);
            if (err != ECDSA.RecoverError.NoError) continue;
            for (uint256 j = 0; j < 3; j++) {
                if (!used[j] && m.sensors[j] == signer) {
                    used[j] = true;
                    temps[n] = readings[i].tempDeci;
                    who[n] = signer;
                    n++;
                    break;
                }
            }
        }
    }

    /// @dev 2-of-3 agreement. Returns the mean of the agreeing readings and flags an outlier.
    function _agree(bytes32 key, uint64 seq, int16[3] memory t, address[3] memory who, uint8 n) internal returns (bool, int16) {
        if (n == 2) {
            if (_absDiff(t[0], t[1]) <= AGREEMENT_TOLERANCE_DECI) return (true, int16((int256(t[0]) + t[1]) / 2));
            return (false, 0);
        }
        // n == 3: sort (tiny insertion sort keeps sensor attribution)
        for (uint256 i = 1; i < 3; i++) {
            for (uint256 j = i; j > 0 && t[j - 1] > t[j]; j--) {
                (t[j - 1], t[j]) = (t[j], t[j - 1]);
                (who[j - 1], who[j]) = (who[j], who[j - 1]);
            }
        }
        if (_absDiff(t[2], t[0]) <= AGREEMENT_TOLERANCE_DECI) return (true, int16((int256(t[0]) + t[1] + t[2]) / 3));
        if (_absDiff(t[1], t[0]) <= AGREEMENT_TOLERANCE_DECI) {
            emit SensorOutlier(key, seq, who[2], t[2]);
            return (true, int16((int256(t[0]) + t[1]) / 2));
        }
        if (_absDiff(t[2], t[1]) <= AGREEMENT_TOLERANCE_DECI) {
            emit SensorOutlier(key, seq, who[0], t[0]);
            return (true, int16((int256(t[1]) + t[2]) / 2));
        }
        return (false, 0);
    }

    function _absDiff(int16 a, int16 b) internal pure returns (int16) {
        return a > b ? a - b : b - a;
    }

    function _kelvin(int16 tempDeci) internal pure returns (SD59x18) {
        return sd(int256(tempDeci) * 1e17 + KELVIN);
    }

    function _arrheniusTerm(int16 tempDeci) internal pure returns (SD59x18) {
        SD59x18 invT = sd(1e18).div(_kelvin(tempDeci));
        SD59x18 invRef = sd(1e18).div(sd(T_REF));
        return exp(sd(DH_OVER_R).mul(invRef.sub(invT)));
    }

    function _mktDeci(int256 sumTerm, uint32 count) internal pure returns (int16) {
        SD59x18 mean = sd(sumTerm).div(sd(int256(uint256(count)) * 1e18));
        SD59x18 invMkt = sd(1e18).div(sd(T_REF)).sub(ln(mean).div(sd(DH_OVER_R)));
        int256 mktK = intoInt256(sd(1e18).div(invMkt));
        // to 0.1 degC with rounding
        return int16((mktK - KELVIN + 5e16) / 1e17);
    }

    function _checkBreach(Monitor storage m, string calldata batchId, bytes32 key, int16 agreed) internal {
        PharmaChain.BatchView memory v = pharma.getBatch(batchId);
        string memory reason;
        if (agreed > v.batch.maxTempDeci + HARD_HIGH_MARGIN_DECI) reason = "Hard excursion: extreme heat";
        else if (agreed < v.batch.minTempDeci - FREEZE_MARGIN_DECI) reason = "Hard excursion: freezing";
        else if (m.mktDeci > v.batch.maxTempDeci) reason = "Mean Kinetic Temperature above storage limit";
        else return;

        m.breached = true;
        emit ColdChainBreach(key, batchId, agreed, m.mktDeci, reason);
        try pharma.quarantineBatch(batchId, reason) {} catch {}
    }

    // ------------------------------------------------------------------ views
    function getMonitor(string calldata batchId)
        external
        view
        returns (address[3] memory sensors, uint64 lastSeq, uint32 count, int16 lastAgreedDeci, int16 mktDeci, bool breached)
    {
        Monitor storage m = _monitors[pharma.keyOf(batchId)];
        return (m.sensors, m.lastSeq, m.count, m.lastAgreedDeci, m.mktDeci, m.breached);
    }

    /// @notice Pure helper so tests/benchmarks can compare on-chain MKT with the JS reference.
    function mktOf(int16[] calldata tempsDeci) external pure returns (int16) {
        int256 sum;
        for (uint256 i = 0; i < tempsDeci.length; i++) sum += intoInt256(_arrheniusTerm(tempsDeci[i]));
        return _mktDeci(sum, uint32(tempsDeci.length));
    }
}
