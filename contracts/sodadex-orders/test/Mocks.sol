// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPermitAllowance {
    function transferFrom(address, address, uint160, address) external;
    function allowance(address, address, address) external view returns (uint160, uint48, uint48);
}

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public feeSender;
    uint256 public senderFeeBps;

    function configureSenderFee(address from, uint256 bps) external {
        feeSender = from;
        senderFeeBps = bps;
    }
    uint256 public fromFeeBps;
    uint256 public transferFeeBps;
    bool public falseApprove;

    function configure(uint256 a, uint256 b, bool c) external {
        fromFeeBps = a;
        transferFeeBps = b;
        falseApprove = c;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (falseApprove) return false;
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount - amount * transferFeeBps / 10000;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount + (from == feeSender ? amount * senderFeeBps / 10000 : 0);
        balanceOf[to] += amount - amount * fromFeeBps / 10000;
        return true;
    }
}

contract MockPool {
    function slot0() external pure returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (1 << 96, 0, 0, 0, 0, 0, true);
    }
}

contract MockFactory {
    address public pool;

    function setPool(address p) external {
        pool = p;
    }

    function getPool(address, address, uint24) external view returns (address) {
        return pool;
    }

    function feeAmountTickSpacing(uint24 fee) external pure returns (int24) {
        return fee == 100 ? int24(1) : fee == 500 ? int24(10) : int24(0);
    }
}

contract MockStateView {
    function getSlot0(bytes32) external pure returns (uint160, int24, uint24, uint24) {
        return (1 << 96, 0, 0, 0);
    }
}

contract MockRouter {
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public input;
    address public output;
    uint256 public spent;
    uint256 public produced;
    bytes public lastCommands;
    bytes[] public lastInputs;
    address public payer;

    function configure(address a, address b, uint256 c, uint256 d) external {
        input = a;
        output = b;
        spent = c;
        produced = d;
    }

    function inputAt(uint256 n) external view returns (bytes memory) {
        return lastInputs[n];
    }

    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable {
        // Match the pinned Router timestamp deadline in this test double.
        // forge-lint: disable-next-line(block-timestamp)
        require(block.timestamp < deadline);
        lastCommands = commands;
        lastInputs = inputs;
        payer = msg.sender;
        require(spent <= type(uint160).max);
        // The preceding bound enforces the exact Permit2 transfer amount without truncation.
        // forge-lint: disable-next-line(unsafe-typecast)
        IPermitAllowance(PERMIT2).transferFrom(msg.sender, address(this), uint160(spent), input);
        if (output == address(0)) {
            (bool ok,) = msg.sender.call{value: produced}("");
            require(ok);
        } else {
            MockToken(output).mint(msg.sender, produced);
        }
    }
}

interface ISettlementCancel {
    function cancel(uint256) external;
}

contract ReentrantReceiver {
    ISettlementCancel public settlement;
    bool public attempted;
    bool public blocked;
    bool public reject;

    constructor(address s, bool r) {
        settlement = ISettlementCancel(s);
        reject = r;
    }

    receive() external payable {
        if (reject) revert();
        attempted = true;
        try settlement.cancel(77) {}
        catch {
            blocked = true;
        }
    }
}

contract SmartMaker {
    bytes32 public allowedDigest;

    function setDigest(bytes32 digest) external {
        allowedDigest = digest;
    }

    function approveToken(address token, address spender, uint256 amount) external {
        MockToken(token).approve(spender, amount);
    }

    function isValidSignature(bytes32 digest, bytes calldata) external view returns (bytes4) {
        return digest == allowedDigest ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
