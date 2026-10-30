// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ArcPay} from "../ArcPay.sol";
import {ArcPayTestBase, MockUSDC} from "./ArcPay.Base.t.sol";

/// @dev Drives bounded random actions against ArcPay. Small actor/name pools
/// force collisions (NameTaken, AlreadyRegistered, self-pay, etc).
contract ArcPayHandler is Test {
    ArcPay public immutable pay;
    MockUSDC public immutable usdc;

    address[] internal _actors;
    string[] internal _names;

    // ghost state
    mapping(bytes32 => address) public firstOwner; // nameHash => owner at first registration
    mapping(address => string) public firstName; // actor => name at first registration
    uint256 public ghostMinted;
    uint256 public ghostRegistrations;
    uint256 public ghostPayments;
    bool public ownershipChanged;

    constructor(ArcPay _pay, MockUSDC _usdc) {
        pay = _pay;
        usdc = _usdc;
        for (uint256 i; i < 4; ++i) {
            address a = address(uint160(0xA000 + i));
            _actors.push(a);
            usdc.mint(a, 1_000_000e6);
            ghostMinted += 1_000_000e6;
            vm.prank(a);
            usdc.approve(address(_pay), type(uint256).max);
        }
        _names.push("alpha");
        _names.push("beta_1");
        _names.push("gamma");
        _names.push("delta");
        _names.push("Bad Name"); // invalid, must never register
        _names.push("ab"); // too short
    }

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    function names() external view returns (string[] memory) {
        return _names;
    }

    function register(uint256 actorSeed, uint256 nameSeed, bytes32 salt, uint256 wait) external {
        address a = _actors[actorSeed % _actors.length];
        string memory name = _names[nameSeed % _names.length];
        wait = bound(wait, 5, 1 days);

        bytes32 c = pay.makeCommitment(name, a, salt);
        vm.prank(a);
        try pay.commit(c) {} catch {
            return;
        }
        skip(wait);
        vm.prank(a);
        try pay.register(name, salt) {
            bytes32 h = keccak256(bytes(name));
            ghostRegistrations++;
            if (firstOwner[h] == address(0)) firstOwner[h] = a;
            else ownershipChanged = true; // a registered name must never be re-registered
            if (bytes(firstName[a]).length == 0) firstName[a] = name;
            else ownershipChanged = true; // a wallet must never get a second name
        } catch {}
    }

    function payAddress(uint256 fromSeed, uint256 toSeed, uint256 amount, bytes32 memo) external {
        address from = _actors[fromSeed % _actors.length];
        address to = _actors[toSeed % _actors.length];
        amount = bound(amount, 0, usdc.balanceOf(from));
        vm.prank(from);
        try pay.pay(to, amount, memo) {
            ghostPayments++;
        } catch {}
    }

    function payName(uint256 fromSeed, uint256 nameSeed, uint256 amount, bytes32 memo) external {
        address from = _actors[fromSeed % _actors.length];
        string memory name = _names[nameSeed % _names.length];
        amount = bound(amount, 0, usdc.balanceOf(from));
        vm.prank(from);
        try pay.payToUsername(name, amount, memo) {
            ghostPayments++;
        } catch {}
    }

    function passTime(uint256 dt) external {
        skip(bound(dt, 0, 2 days));
    }
}

contract ArcPayInvariantTest is ArcPayTestBase {
    ArcPayHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new ArcPayHandler(pay, usdc);
        targetContract(address(handler));
    }

    /// The router never custodies funds.
    function invariant_ContractUsdcBalanceIsZero() public view {
        assertEq(usdc.balanceOf(address(pay)), 0);
    }

    /// Payments only move tokens around: total supply == sum of actor balances.
    function invariant_UsdcConserved() public view {
        address[] memory a = handler.actors();
        uint256 sum;
        for (uint256 i; i < a.length; ++i) sum += usdc.balanceOf(a[i]);
        assertEq(sum, handler.ghostMinted());
        assertEq(usdc.totalSupply(), handler.ghostMinted());
    }

    /// Each name has at most one owner and owner <-> name is a bijection.
    function invariant_EachNameHasAtMostOneOwner() public view {
        address[] memory a = handler.actors();
        string[] memory n = handler.names();
        for (uint256 j; j < n.length; ++j) {
            uint256 holders;
            for (uint256 i; i < a.length; ++i) {
                if (keccak256(bytes(pay.usernameOf(a[i]))) == keccak256(bytes(n[j]))) holders++;
            }
            assertLe(holders, 1, "name held by >1 wallet");
            address r = pay.resolve(n[j]);
            if (r != address(0)) {
                assertEq(holders, 1, "resolved name without matching holder");
                assertEq(pay.usernameOf(r), n[j], "resolve/usernameOf mismatch");
            } else {
                assertEq(holders, 0, "holder without resolve entry");
            }
        }
    }

    /// Names are permanent and never reassigned; wallets never get a second name.
    function invariant_NamesPermanentAndOneNamePerWallet() public view {
        assertFalse(handler.ownershipChanged());
        address[] memory a = handler.actors();
        string[] memory n = handler.names();
        for (uint256 j; j < n.length; ++j) {
            address first = handler.firstOwner(keccak256(bytes(n[j])));
            if (first != address(0)) assertEq(pay.resolve(n[j]), first);
        }
        for (uint256 i; i < a.length; ++i) {
            string memory first = handler.firstName(a[i]);
            if (bytes(first).length != 0) assertEq(pay.usernameOf(a[i]), first);
        }
    }

    /// Invalid names can never be registered.
    function invariant_InvalidNamesNeverRegistered() public view {
        assertEq(pay.resolve("Bad Name"), address(0));
        assertEq(pay.resolve("ab"), address(0));
    }
}
