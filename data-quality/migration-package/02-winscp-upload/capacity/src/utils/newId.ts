function fallbackUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

/** Ensures crypto.randomUUID works (e.g. HTTP via LAN IP, older browsers). */
export function installCryptoPolyfill(): void {
  const globalCrypto = globalThis.crypto
  if (!globalCrypto || typeof globalCrypto.randomUUID !== 'function') {
    const target = globalCrypto ?? ({} as Crypto)
    Object.defineProperty(target, 'randomUUID', {
      value: fallbackUuid,
      configurable: true,
      writable: true,
    })
    if (!globalThis.crypto) {
      Object.defineProperty(globalThis, 'crypto', {
        value: target,
        configurable: true,
      })
    }
  }
}

export function newId(): string {
  installCryptoPolyfill()
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return fallbackUuid()
}
