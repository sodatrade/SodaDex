// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice The vault owns eligibility, locked shares and historical-income settlement.
interface IFabsVault {
    function FABS() external view returns (address);
    function FABS_HOOK_VERSION() external view returns (bytes32);

    /// @dev Called only by FABS before balances/supply change, including mint and burn.
    /// Must settle using OLD balances and reject transfers of redemption-locked shares.
    /// Return this function's selector on success; any failure rolls back the token operation.
    function beforeFabsTransfer(address from, address to, uint256 amount) external returns (bytes4);
}
