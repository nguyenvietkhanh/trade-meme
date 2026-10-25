> ## Documentation Index
> Fetch the complete documentation index at: https://docs.polymarket.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Contracts

> All Polymarket smart contract addresses, audits, and security resources

These contracts are deployed on Polygon mainnet with chain ID `137`. Use the
proxy address when a contract has separate proxy and implementation addresses.

> **[CTF Exchange V2](https://github.com/Polymarket/ctf-exchange-v2)**
>
> Order matching and settlement for CTF markets.

> **[Polymarket V2 contracts](https://github.com/Polymarket/polymarket-v2-external)**
>
> Position tokens, modules, oracles, and audits for V2 markets.

***

## Core Contracts

| Contract | Address |
| - | - |
| CTF Exchange | [`0xE111180000d2663C0091e4f400237545B87B996B`](https://polygonscan.com/address/0xE111180000d2663C0091e4f400237545B87B996B) |
| Neg Risk CTF Exchange | [`0xe2222d279d744050d28e00520010520000310F59`](https://polygonscan.com/address/0xe2222d279d744050d28e00520010520000310F59) |
| Neg Risk Adapter (CTF negative-risk approvals) | [`0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`](https://polygonscan.com/address/0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296) |
| Conditional Tokens (CTF) | [`0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`](https://polygonscan.com/address/0x4D97DCd97eC945f40cF65F87097ACe5EA0476045) |
| PositionManager Poly v2 | [`0x006F54F7f9A22e0000CC2AB60031000000ae9fEF`](https://polygonscan.com/address/0x006F54F7f9A22e0000CC2AB60031000000ae9fEF) |
| Router Poly v2 | [`0x12121212006e4CD160D18e3f00711DA5c3372600`](https://polygonscan.com/address/0x12121212006e4CD160D18e3f00711DA5c3372600) |
| BinaryModule Poly v2 | [`0x1000008dD9001B968442c1000017eaE6E0dA00Ba`](https://polygonscan.com/address/0x1000008dD9001B968442c1000017eaE6E0dA00Ba) |
| NegRiskModule Poly v2 | [`0x200000900045e3B6259600682756002200028933`](https://polygonscan.com/address/0x200000900045e3B6259600682756002200028933) |
| CombinatorialModule Poly v2 | [`0x30000034706C7d8e12009DAB006Be20000c031A8`](https://polygonscan.com/address/0x30000034706C7d8e12009DAB006Be20000c031A8) |
| ExchangeV3 Poly v2 | [`0xe3333700cA9d93003F00f0F71f8515005F6c00Aa`](https://polygonscan.com/address/0xe3333700cA9d93003F00f0F71f8515005F6c00Aa) |
| AutoRedeemer Poly v2 | [`0xa1200000d0002264C9a1698e001292D00E1b00af`](https://polygonscan.com/address/0xa1200000d0002264C9a1698e001292D00E1b00af) |

***

The pUSD collateral system and account wallets support both position systems.
The CTF collateral adapters move value between pUSD and the collateral used by
CTF.

| Contract | Address |
| - | - |
| pUSD — CollateralToken Poly v2 | [`0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB`](https://polygonscan.com/address/0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB) |
| CollateralOnramp Poly v2 | [`0x93070a847efEf7F70739046A929D47a521F5B8ee`](https://polygonscan.com/address/0x93070a847efEf7F70739046A929D47a521F5B8ee) |
| CollateralOfframp Poly v2 | [`0x2957922Eb93258b93368531d39fAcCA3B4dC5854`](https://polygonscan.com/address/0x2957922Eb93258b93368531d39fAcCA3B4dC5854) |
| PermissionedRamp Poly v2 | [`0xebC2459Ec962869ca4c0bd1E06368272732BCb08`](https://polygonscan.com/address/0xebC2459Ec962869ca4c0bd1E06368272732BCb08) |
| CtfCollateralAdapter | [`0xAdA100Db00Ca00073811820692005400218FcE1f`](https://polygonscan.com/address/0xAdA100Db00Ca00073811820692005400218FcE1f) |
| NegRiskCtfCollateralAdapter | [`0xadA2005600Dec949baf300f4C6120000bDB6eAab`](https://polygonscan.com/address/0xadA2005600Dec949baf300f4C6120000bDB6eAab) |

| Contract | Address |
| - | - |
| pUSD CollateralToken proxy | [`0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB`](https://polygonscan.com/address/0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB) |
| pUSD CollateralToken implementation | [`0xCe84E053301A82937F90ee2C2c1889cAb1db25dE`](https://polygonscan.com/address/0xCe84E053301A82937F90ee2C2c1889cAb1db25dE) |
| CollateralOnramp | [`0x93070a847efEf7F70739046A929D47a521F5B8ee`](https://polygonscan.com/address/0x93070a847efEf7F70739046A929D47a521F5B8ee) |
| CollateralOfframp | [`0x2957922Eb93258b93368531d39fAcCA3B4dC5854`](https://polygonscan.com/address/0x2957922Eb93258b93368531d39fAcCA3B4dC5854) |
| PermissionedRamp | [`0xebC2459Ec962869ca4c0bd1E06368272732BCb08`](https://polygonscan.com/address/0xebC2459Ec962869ca4c0bd1E06368272732BCb08) |
| CtfCollateralAdapter | [`0xAdA100Db00Ca00073811820692005400218FcE1f`](https://polygonscan.com/address/0xAdA100Db00Ca00073811820692005400218FcE1f) |
| NegRiskCtfCollateralAdapter | [`0xadA2005600Dec949baf300f4C6120000bDB6eAab`](https://polygonscan.com/address/0xadA2005600Dec949baf300f4C6120000bDB6eAab) |

### Wallet Factory Contracts

| Contract | Address |
| - | - |
| Deposit Wallet Factory | [`0x00000000000Fb5C9ADea0298D729A0CB3823Cc07`](https://polygonscan.com/address/0x00000000000Fb5C9ADea0298D729A0CB3823Cc07) |
| Deposit Wallet Beacon | [`0x7A18EDfe055488A3128f01F563e5B479D92ffc3a`](https://polygonscan.com/address/0x7A18EDfe055488A3128f01F563e5B479D92ffc3a) |
| Gnosis Safe Factory | [`0xaacfeea03eb1561c4e67d661e40682bd20e3541b`](https://polygonscan.com/address/0xaacfeea03eb1561c4e67d661e40682bd20e3541b) |
| Polymarket Proxy Factory | [`0xaB45c5A4B0c941a2F231C04C3f49182e1A254052`](https://polygonscan.com/address/0xaB45c5A4B0c941a2F231C04C3f49182e1A254052) |

## CTF

These contracts own and exchange CTF outcome balances.

| Contract | Address |
| - | - |
| Conditional Tokens | [`0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`](https://polygonscan.com/address/0x4D97DCd97eC945f40cF65F87097ACe5EA0476045) |
| CTF Exchange | [`0xE111180000d2663C0091e4f400237545B87B996B`](https://polygonscan.com/address/0xE111180000d2663C0091e4f400237545B87B996B) |
| Neg Risk CTF Exchange | [`0xe2222d279d744050d28e00520010520000310F59`](https://polygonscan.com/address/0xe2222d279d744050d28e00520010520000310F59) |
| Neg Risk Adapter (CTF negative-risk approvals) | [`0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`](https://polygonscan.com/address/0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296) |

The CLOB still checks pUSD and Conditional Tokens approvals for the Neg Risk
Adapter on orders in CTF negative-risk markets. Grant them with the other
[trading approvals](https://docs.polymarket.com/trading/wallets-auth.md#set-up-trading-approvals). This Neg
Risk Adapter (`0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`) is a different
contract from NegRiskCtfCollateralAdapter
(`0xadA2005600Dec949baf300f4C6120000bDB6eAab`); approving
NegRiskCtfCollateralAdapter does not grant the Neg Risk Adapter approvals.

## Polymarket Protocol V2 Contracts

PositionManager owns the ERC-1155 balances. The position ID routes each
operation to BinaryModule, NegRiskModule, or CombinatorialModule.

| Contract | Proxy | Implementation |
| - | - | - |
| PositionManager | [`0x006F54F7f9A22e0000CC2AB60031000000ae9fEF`](https://polygonscan.com/address/0x006F54F7f9A22e0000CC2AB60031000000ae9fEF) | [`0xCc5De1e9D14a7AB75E872E23FC9D605518Bac2D0`](https://polygonscan.com/address/0xCc5De1e9D14a7AB75E872E23FC9D605518Bac2D0) |
| Exchange | [`0xe3333700cA9d93003F00f0F71f8515005F6c00Aa`](https://polygonscan.com/address/0xe3333700cA9d93003F00f0F71f8515005F6c00Aa) | [`0x641b40ec414a076b9e79E703Fc7BF4EBEC248Bb7`](https://polygonscan.com/address/0x641b40ec414a076b9e79E703Fc7BF4EBEC248Bb7) |
| Router | [`0x12121212006e4CD160D18e3f00711DA5c3372600`](https://polygonscan.com/address/0x12121212006e4CD160D18e3f00711DA5c3372600) | [`0x91fA5E2F12a308A13DefdB6aaF80B71DBe9B7696`](https://polygonscan.com/address/0x91fA5E2F12a308A13DefdB6aaF80B71DBe9B7696) |
| BinaryModule | [`0x1000008dD9001B968442c1000017eaE6E0dA00Ba`](https://polygonscan.com/address/0x1000008dD9001B968442c1000017eaE6E0dA00Ba) | [`0xf6428c0B5fa9361c0708CDdb95468cf54C56e9A2`](https://polygonscan.com/address/0xf6428c0B5fa9361c0708CDdb95468cf54C56e9A2) |
| NegRiskModule | [`0x200000900045e3B6259600682756002200028933`](https://polygonscan.com/address/0x200000900045e3B6259600682756002200028933) | [`0x39a5B01a100edF811f2748aa37B1313715Ded70e`](https://polygonscan.com/address/0x39a5B01a100edF811f2748aa37B1313715Ded70e) |
| CombinatorialModule | [`0x30000034706C7d8e12009DAB006Be20000c031A8`](https://polygonscan.com/address/0x30000034706C7d8e12009DAB006Be20000c031A8) | [`0xf96968a44022B17240B42c557693E7C383d2d8a3`](https://polygonscan.com/address/0xf96968a44022B17240B42c557693E7C383d2d8a3) |

## Resolution Contracts

| Contract | Address |
| - | - |
| UMA Adapter | [`0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74`](https://polygonscan.com/address/0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74) |
| UMA Optimistic Oracle | [`0xCB1822859cEF82Cd2Eb4E6276C7916e692995130`](https://polygonscan.com/address/0xCB1822859cEF82Cd2Eb4E6276C7916e692995130) |
| OracleAggregator Poly v2 | [`0x0A0a0A0A8B00C51b7D810501b03F230028C04a87`](https://polygonscan.com/address/0x0A0a0A0A8B00C51b7D810501b03F230028C04a87) |
| OOReporterModule Poly v2 | [`0x000012e0009c84078c4924fba808A41b9f67527f`](https://polygonscan.com/address/0x000012e0009c84078c4924fba808A41b9f67527f) |
| ChainlinkReporterModule Poly v2 | [`0xc12EC12E0000326890Ca5560dEf5EB5C22b16814`](https://polygonscan.com/address/0xc12EC12E0000326890Ca5560dEf5EB5C22b16814) |
| EOAReporterModule Poly v2 | [`0x8Ef9D6d668798b1f363b305D916F30739d2b0419`](https://polygonscan.com/address/0x8Ef9D6d668798b1f363b305D916F30739d2b0419) |

| Contract | Address |
| - | - |
| UmaCtfAdapter v3.1.0 | [`0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49`](https://polygonscan.com/address/0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49) |
| UmaCtfAdapter v2.0.0 | [`0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74`](https://polygonscan.com/address/0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74) |
| UmaCtfAdapter v1.0.0 | [`0xCB1822859cEF82Cd2Eb4E6276C7916e692995130`](https://polygonscan.com/address/0xCB1822859cEF82Cd2Eb4E6276C7916e692995130) |

### Polymarket Protocol V2

OracleAggregator receives results from the supported reporter modules and sends
the final result to the module that owns the condition.

| Contract | Proxy | Implementation |
| - | - | - |
| OracleAggregator | [`0x0A0a0A0A8B00C51b7D810501b03F230028C04a87`](https://polygonscan.com/address/0x0A0a0A0A8B00C51b7D810501b03F230028C04a87) | [`0x822e8A97AF8005073F2f6E88435D692E33ab6082`](https://polygonscan.com/address/0x822e8A97AF8005073F2f6E88435D692E33ab6082) |
| OOReporterModule | [`0x000012e0009c84078c4924fba808A41b9f67527f`](https://polygonscan.com/address/0x000012e0009c84078c4924fba808A41b9f67527f) | [`0xBd49A21677Da630fF5Efec52B7309d0Ada685d81`](https://polygonscan.com/address/0xBd49A21677Da630fF5Efec52B7309d0Ada685d81) |
| ChainlinkReporterModule | [`0xc12EC12E0000326890Ca5560dEf5EB5C22b16814`](https://polygonscan.com/address/0xc12EC12E0000326890Ca5560dEf5EB5C22b16814) | [`0x70545d95653a4a7B1c2F47f6a9383E36EaAA55b2`](https://polygonscan.com/address/0x70545d95653a4a7B1c2F47f6a9383E36EaAA55b2) |
| EOAReporterModule | [`0x8Ef9D6d668798b1f363b305D916F30739d2b0419`](https://polygonscan.com/address/0x8Ef9D6d668798b1f363b305D916F30739d2b0419) | [`0x5fe0280873f5539da12B6b5b37484E0B0c28Ab14`](https://polygonscan.com/address/0x5fe0280873f5539da12B6b5b37484E0B0c28Ab14) |

## Redemption and Migration

| Contract | Proxy | Implementation |
| - | - | - |
| AutoRedeemer | [`0xa1200000d0002264C9a1698e001292D00E1b00af`](https://polygonscan.com/address/0xa1200000d0002264C9a1698e001292D00E1b00af) | [`0x64860bFD14fCcaAc09cd36f347784a9616AfB66C`](https://polygonscan.com/address/0x64860bFD14fCcaAc09cd36f347784a9616AfB66C) |

AutoRedeemer supports resolved balances from Conditional Tokens and
PositionManager. CTF-to-PositionManager migration is implemented by the
BinaryModule and NegRiskModule addresses listed above. A condition or event must
be registered by Polymarket before a holder can migrate its positions.

See [Onchain Position Data](https://docs.polymarket.com/resources/onchain-position-data.md) for the events and
identifiers used to index redemptions and migrations.

## Security

### Audits

Polymarket's contracts have been reviewed by multiple independent security firms:

| Scope | Auditor | Report |
| - | - | - |
| v1.2.0 | Cantina | [August 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/v1.2.0%20-%20Cantina%20-%20August%202026.pdf) |
| v1.2.0 | Quantstamp | [August 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/v1.2.0%20-%20Quantstamp%20-%20August%202026.pdf) |
| Formal Verification | Certora | [August 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Formal%20Verification%20-%20Certora%20-%20August%202026.pdf) |
| Oracle Subsystem | Cantina | [July 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Oracle%20Subsystem%20-%20Cantina%20-%20July%202026.pdf) |
| Oracle Subsystem | Certora | [July 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Oracle%20Subsystem%20-%20Certora%20-%20July%202026.pdf) |
| Combo Collateral Return + CCIP | Cantina | [July 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Combo%20Collateral%20Return%20%2B%20CCIP%20-%20Cantina%20-%20July%202026.pdf) |
| Combo Collateral Return + CCIP | Certora | [July 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Combo%20Collateral%20Return%20%2B%20CCIP%20-%20Certora%20-%20July%202026.pdf) |
| Combinatorial Module | Cantina | [May 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Combinatorial%20Module%20-%20Cantina%20-%20May%202026.pdf) |
| Combinatorial Module | Certora | [May 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Combinatorial%20Module%20-%20Certora%20-%20May%202026.pdf) |
| Combinatorial Module | Quantstamp | [May 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Combinatorial%20Module%20-%20Quantstamp%20-%20May%202026.pdf) |
| Polymarket V2 | SigmaPrime | [June 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Polymarket%20V2%20-%20SigmaPrime%20-%20June%202026.pdf) |
| Polymarket V2 | Zellic | [June 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Polymarket%20V2%20-%20Zellic%20-%20June%202026.pdf) |
| Polymarket V2 | Pashov | [May 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Polymarket%20V2%20-%20Pashov%20-%20May%202026.pdf) |
| Polymarket V2 | Quantstamp | [May 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Polymarket%20V2%20-%20Quantstamp%20-%20May%202026.pdf) |
| Polymarket V2 | Cantina | [April 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Polymarket%20V2%20-%20Cantina%20-%20April%202026.pdf) |
| Polymarket V2 | Certora | [April 2026](https://github.com/Polymarket/polymarket-v2-external/blob/main/audit/Polymarket%20V2%20-%20Certora%20-%20April%202026.pdf) |
| CTF Exchange V2 | Quantstamp | [March 2026](https://github.com/Polymarket/ctf-exchange-v2/blob/main/audits/CTF%20Exchange%20V2%20-%20Quantstamp%20-%20March%202026.pdf) |
| CTF Exchange V2 | Cantina | [March 2026](https://github.com/Polymarket/ctf-exchange-v2/blob/main/audits/CTF%20Exchange%20V2%20-%20Cantina%20-%20March%202026.pdf) |

### Bug Bounty

Security vulnerabilities can be reported through the [Cantina bug bounty program](https://cantina.xyz/bounties/ff945ca2-2a6e-4b83-b1b6-7a0cd3b94bea).


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.