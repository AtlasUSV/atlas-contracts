# Atlas USV Smart Contracts


##  Setting up Local Development
Required: 
- [Node v14](https://nodejs.org/download/release/latest-v14.x/)  
- [Git](https://git-scm.com/downloads)


Local Setup Steps:
1. git clone https://github.com/AtlasUSV/atlas-contracts.git 
1. Install dependencies: `npm install` 
    - Installs [Hardhat](https://hardhat.org/getting-started/) & [OpenZepplin](https://docs.openzeppelin.com/contracts/4.x/) dependencies
1. Compile Solidity: `npm run compile`

## Polygon Contracts & Addresses

|Contract       | Addresss                                                                                                            | Notes   |
|:-------------:|:-------------------------------------------------------------------------------------------------------------------:|-------|
|USV            |[0xAC63686230f64BDEAF086Fe6764085453ab3023F](https://polygonscan.com/address/0xAC63686230f64BDEAF086Fe6764085453ab3023F)| Main Token Contract|
|sUSV           |[0x01D119e2F0441eA442e3ab84e0dBbf04bd993556](https://polygonscan.com/address/0x01D119e2F0441eA442e3ab84e0dBbf04bd993556)| Staked USV |
|Treasury       |[0x71EF2894E23D7ea7Fd73a3558B3a0bA25689bC86](https://polygonscan.com/address/0x71EF2894E23D7ea7Fd73a3558B3a0bA25689bC86)| Atlas USV Treasury holds all the assets |
|Staking        |[0x99bbc86E1f5447cf1908b27CEd0D2a0B9aA5efb2](https://polygonscan.com/address/0x99bbc86E1f5447cf1908b27CEd0D2a0B9aA5efb2)| Main Staking contract responsible for calling rebases every 12872 blocks |
|StakingHelper  |[0xb56969Ec8c212aa1Be233440FB143b4391BEd5FE](https://polygonscan.com/address/0xb56969Ec8c212aa1Be233440FB143b4391BEd5FE)| Helper Contract to Stake with 0 warmup |
|Atlas Team     |[0x6a822327ef6aa95e4b79e0a6c6be196a0cc45286](https://polygonscan.com/address/0x6a822327ef6aa95e4b79e0a6c6be196a0cc45286)| Storage Wallet for AtlasTeam |
|Staking Warmup |[0x9102DED7542D05085C83f9c29A0d93282B7Ef3eC](https://polygonscan.com/address/0x9102DED7542D05085C83f9c29A0d93282B7Ef3eC)| Instructs the Staking contract when a user can claim sUSV |


**Barters**
All LP barters use the Bartering Calculator contract which is used to compute RFV. 

|Contract       | Addresss                                                                                                            | Notes   |
|:-------------:|:-------------------------------------------------------------------------------------------------------------------:|-------|
|Barter Calculator|[0xe35eb353cc074Ecbc1aea3975F64BA084f1b06C5](https://polygonscan.com/address/0xe35eb353cc074Ecbc1aea3975F64BA084f1b06C5)| |
|DAI barter|[0x8cbCAaCF6d5e13F17b71aD98f6910d5656Ac3c8F](https://polygonscan.com/address/0x8cbCAaCF6d5e13F17b71aD98f6910d5656Ac3c8F)| Main barter managing serve mechanics for USV/DAI|
|DAI/USV SLP Barter|[0x20A1DC647f26ca38eD19A7e66C7Eef621CC75B0E](https://polygonscan.com/address/0x20A1DC647f26ca38eD19A7e66C7Eef621CC75B0E)| Manages mechanism for the protocol to buy back its own liquidity from the pair. |
|FRAX Barter|[0x96eAdC4fFabBFA6B2Fc30DD98F527009E167214B](https://polygonscan.com/address/0x96eAdC4fFabBFA6B2Fc30DD98F527009E167214B)|Similar to DAI barter but using FRAX|


## Allocator Guide

The following is a guide for interacting with the treasury as a reserve allocator.

A reserve allocator is a contract that deploys funds into external strategies.

Treasury Address: `0x71EF2894E23D7ea7Fd73a3558B3a0bA25689bC86`

**Managing**:
The first step is withdraw funds from the treasury via the "manage" function. "Manage" allows an approved address to withdraw excess reserves from the treasury.

*Note*: This contract must have the "reserve manager" permission, and that withdrawn reserves decrease the treasury's ability to mint new USV (since backing has been removed).

Pass in the token address and the amount to manage. The token will be sent to the contract calling the function.

```
function manage( address _token, uint _amount ) external;
```

Managing treasury assets should look something like this:
```
treasury.manage( DAI, amountToManage );
```

**Returning**:
The second step is to return funds after the strategy has been closed.
We utilize the `deposit` function to do this. Deposit allows an approved contract to deposit reserve assets into the treasury, and mint USV against them. In this case however, we will NOT mint any USV. This will be explained shortly.

*Note* The contract must have the "reserve depositor" permission, and that deposited reserves increase the treasury's ability to mint new USV (since backing has been added).


Pass in the address sending the funds (most likely the allocator contract), the amount to deposit, and the address of the token. The final parameter, profit, dictates how much USV to send. send_, the amount of USV to send, equals the value of amount minus profit.
```
function deposit( address _from, uint _amount, address _token, uint _profit ) external returns ( uint send_ );
```

To ensure no USV is minted, we first get the value of the asset, and pass that in as profit.
Pass in the token address and amount to get the treasury value.
```
function valueOf( address _token, uint _amount ) public view returns ( uint value_ );
```

All together, returning funds should look something like this:
```
treasury.deposit( address(this), amountToReturn, DAI, treasury.valueOf( DAI, amountToReturn ) );
```
