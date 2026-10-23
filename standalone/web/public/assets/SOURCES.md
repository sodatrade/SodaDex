# Official asset sources

Retrieved and checked on 2026-10-16. Files are served locally; the UI makes no remote image requests. Marks retain their issuer identity and are not recolored.

| Local file | Official source | SHA-256 |
| --- | --- | --- |
| `okb.png` | [Current OKX OKB page](https://www.okx.com/price/okb-okb), [image](https://www.okx.com/cdn/announce/20230419/16818755125565e5c0127-9cb7-4f32-864a-cdc63448a3b2.png) | `be310dd7ec1349c0b353c0a4d17b4c6905b5b51301787690631860eadefbc996` |
| `wokb.png` | [OKX X Layer token list](https://github.com/okx/xlayer-tokenlist/blob/main/xlayer.tokenlist.json), `chainId: 196`, WOKB `0xe538905cf8410324e03A5A23C1c177a474D59b2b`, [logoURI image](https://okx.com/cdn/web3/currency/token/small/196-0xe538905cf8410324e03a5a23c1c177a474d59b2b-107?v=1750421945476) | `5ce174b09a097862e25741ca77eea51a26ad3e64621f8e61003c44ae080cf6fa` |
| `xlayer.svg` | [OKX X Layer official media kit](https://github.com/okx/xlayer-docs/blob/main/media-kit/XLayer-logo-kit.zip), archive entry `XL/PROFILE ICON W- BACKGROUND/SVG/XLayer_Profile_WhenLessThan40px_White.svg` | `f837468b7de4079c832bcd8d410d0c4cb90002f9e8f331e32a2e2b72a399eb88` |

| `usdt0.png` | [OKX X Layer token list](https://github.com/okx/xlayer-tokenlist/blob/main/xlayer.tokenlist.json), USD₮0 `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`, [logoURI image](https://okx.com/cdn/web3/currency/token/large/196-0x779ded0c9e1022225f8e0630b35a9b54be713736-107/type=default_90_0?v=1758597811461) | `df5238a34df0255a1356485cd6939c521c125e22a25d43fe6d3ca0c98eab0403` |

WOKB also receives an explicit `W` badge in the UI to distinguish it from native OKB. The X Layer SVG was checked for scripts and external references; its original paths and colors are preserved.

## X Layer token directory

Mirrored unchanged from the `logoURI` entries of the [official X Layer list](https://github.com/okx/xlayer-tokenlist/blob/main/xlayer.tokenlist.json), retrieved 2026-10-16.

| Local file | Asset / source | SHA-256 |
| --- | --- | --- |
| `tokens/0x74b7f16337b8972027f6196a17a631ac6de26d22.png` | [USDC](https://okx.com/cdn/web3/currency/token/large/637-0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b-107/type=default_90_0?v=1756203256814) · `0x74b7f16337b8972027f6196a17a631ac6de26d22` | `32aa99cbdc067c7e8609c1b016b6a9d91e41e59ead9692f25278dcc08701b467` |
| `tokens/0xc5015b9d9161dca7e18e32f6f25c4ad850731fd4.png` | [DAI](https://okx.com/cdn/web3/currency/token/small/196-0xc5015b9d9161dca7e18e32f6f25c4ad850731fd4-1?v=1744949565136) · `0xc5015b9d9161dca7e18e32f6f25c4ad850731fd4` | `6e48057801b656fc2658e7b12c7893e7b8ace26dc0b8f246f376b8cf955b3129` |
| `tokens/0x4ae46a509f6b1d9056937ba4500cb143933d2dc8.png` | [USDG](https://okx.com/cdn/web3/currency/token/large/196-0x4ae46a509f6b1d9056937ba4500cb143933d2dc8-107/type=default_90_0?v=1759823460266) · `0x4ae46a509f6b1d9056937ba4500cb143933d2dc8` | `15a525a24b41ddf569ec4d8b583d91968fb4c4e60b961d3c550d9db35a412da8` |
| `tokens/0xe7b000003a45145decf8a28fc755ad5ec5ea025a.png` | [xETH](https://static.coinall.ltd/cdn/assets/imgs/984/F7DAB453A54E41668348307090146E36.png) · `0xe7b000003a45145decf8a28fc755ad5ec5ea025a` | `70172b0352cf49d468d670543841a8d73ad1b1ff0f2ff678c8bff0d69b219808` |
| `tokens/0x505000008de8748dbd4422ff4687a4fc9beba15b.png` | [xSOL](https://static.coinall.ltd/cdn/assets/imgs/787/817E899F4586412D85B0AB3771E8CCB4.png) · `0x505000008de8748dbd4422ff4687a4fc9beba15b` | `254681b94fff81cb3ea2a7590f5160598545a613297a6eeb21e455d127739d96` |
| `tokens/0xafeab3b85b6a56cf5f02317f0f7a23340eb983d7.png` | [xBETH](https://static.coinall.ltd/cdn/assets/imgs/245/00C72289BD7C4180A0317383462FEC59.png) · `0xafeab3b85b6a56cf5f02317f0f7a23340eb983d7` | `d84678fdea64c2c3a0e62adc5f9f6304b9f3352b62f21335feb2a04f907c8ae3` |
| `tokens/0x14a686103854dab7b8801e31979caa595835b25d.png` | [xOKSOL](https://static.coinall.ltd/cdn/assets/imgs/907/15D5974EF3AF4016B9927F25296CDF4C.png) · `0x14a686103854dab7b8801e31979caa595835b25d` | `74e4b655a3b66f4efcfe3012f813c1f9ddc7c8a81e08329e07a89f13e64fe1c7` |
| `tokens/0xb7c00000bcdeef966b20b3d884b98e64d2b06b4f.png` | [xBTC](https://okx.com/cdn/web3/currency/token/large/196-0xb7c00000bcdeef966b20b3d884b98e64d2b06b4f-107/type=default_90_0?v=1759829231572) · `0xb7c00000bcdeef966b20b3d884b98e64d2b06b4f` | `8c70c36d640cc15675744749b858e50dd9a3d801be450c98dce01db3fbdc008e` |
