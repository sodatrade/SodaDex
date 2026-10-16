const icons: Readonly<Record<string, string>> = {
  "0xe538905cf8410324e03a5a23c1c177a474d59b2b": "/assets/wokb.png",
  "0x779ded0c9e1022225f8e0630b35a9b54be713736": "/assets/usdt0.png",
  "0x74b7f16337b8972027f6196a17a631ac6de26d22": "/assets/tokens/0x74b7f16337b8972027f6196a17a631ac6de26d22.png",
  "0xc5015b9d9161dca7e18e32f6f25c4ad850731fd4": "/assets/tokens/0xc5015b9d9161dca7e18e32f6f25c4ad850731fd4.png",
  "0x4ae46a509f6b1d9056937ba4500cb143933d2dc8": "/assets/tokens/0x4ae46a509f6b1d9056937ba4500cb143933d2dc8.png",
  "0xe7b000003a45145decf8a28fc755ad5ec5ea025a": "/assets/tokens/0xe7b000003a45145decf8a28fc755ad5ec5ea025a.png",
  "0x505000008de8748dbd4422ff4687a4fc9beba15b": "/assets/tokens/0x505000008de8748dbd4422ff4687a4fc9beba15b.png",
  "0xafeab3b85b6a56cf5f02317f0f7a23340eb983d7": "/assets/tokens/0xafeab3b85b6a56cf5f02317f0f7a23340eb983d7.png",
  "0x14a686103854dab7b8801e31979caa595835b25d": "/assets/tokens/0x14a686103854dab7b8801e31979caa595835b25d.png",
  "0xb7c00000bcdeef966b20b3d884b98e64d2b06b4f": "/assets/tokens/0xb7c00000bcdeef966b20b3d884b98e64d2b06b4f.png"
}

/** Official issuer marks, pinned locally from the X Layer token list. */
export function tokenIcon(address: string, native = false): string | undefined {
  return native || /^0x0{40}$/i.test(address) ? '/assets/okb.png' : icons[address.toLowerCase()]
}
