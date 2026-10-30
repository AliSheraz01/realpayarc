// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcPay} from "../ArcPay.sol";

/// @dev Minimal 6-decimal ERC-20 used as USDC in tests.
contract MockUSDC {
    string public name = "Mock USDC";
    string public symbol = "mUSDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

abstract contract ArcPayTestBase is Test {
    ArcPay internal pay;
    MockUSDC internal usdc;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    bytes32 internal constant SALT = keccak256("salt");
    bytes32 internal constant MEMO = keccak256("memo");

    // Re-declared for vm.expectEmit (events live on the ArcPay contract).
    event UsernameCommitted(address indexed owner, bytes32 indexed commitment);
    event UsernameRegistered(address indexed owner, bytes32 indexed nameHash, string name);
    event Payment(address indexed from, address indexed to, uint256 amount, bytes32 memo);

    function setUp() public virtual {
        usdc = new MockUSDC();
        pay = new ArcPay(IERC20(address(usdc)));
        vm.warp(1_700_000_000);
    }

    /// @dev commit + wait 5s + reveal for `who`.
    function _register(address who, string memory name, bytes32 salt) internal {
        bytes32 c = pay.makeCommitment(name, who, salt);
        vm.prank(who);
        pay.commit(c);
        skip(pay.MIN_COMMITMENT_AGE());
        vm.prank(who);
        pay.register(name, salt);
    }

    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(pay), type(uint256).max);
    }
}
