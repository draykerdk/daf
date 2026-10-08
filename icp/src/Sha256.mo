/// Sha256 — SHA-256 (FIPS 180-4) over bytes, in plain Motoko.
///
/// Pure functions only, no state. The event log v1 hashes short ASCII
/// preimages, so the code favours clarity over speed.

import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Char "mo:core/Char";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat32 "mo:core/Nat32";
import Text "mo:core/Text";
import VarArray "mo:core/VarArray";

module {
  let K : [Nat32] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let H0 : [Nat32] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  /// The 32-byte digest of `data`.
  public func digest(data : [Nat8]) : [Nat8] {
    let n = data.size();
    // Message, the 0x80 marker, zero padding, then the 64-bit big-endian bit length.
    let total = ((n + 9 + 63) / 64) * 64;
    let m = VarArray.repeat<Nat8>(0, total);
    var i = 0;
    while (i < n) { m[i] := data[i]; i += 1 };
    m[n] := 0x80;
    var bits = n * 8;
    var j = 0;
    while (j < 8) {
      m[total - 1 - j] := Nat.toNat8(bits % 256);
      bits := bits / 256;
      j += 1;
    };

    let h = H0.toVarArray<Nat32>();
    let w = VarArray.repeat<Nat32>(0, 64);
    var off = 0;
    while (off < total) {
      var t = 0;
      while (t < 16) {
        let p = off + 4 * t;
        w[t] := (m[p].toNat32() << 24) | (m[p + 1].toNat32() << 16) | (m[p + 2].toNat32() << 8) | m[p + 3].toNat32();
        t += 1;
      };
      while (t < 64) {
        let s0 = (w[t - 15] <>> 7) ^ (w[t - 15] <>> 18) ^ (w[t - 15] >> 3);
        let s1 = (w[t - 2] <>> 17) ^ (w[t - 2] <>> 19) ^ (w[t - 2] >> 10);
        w[t] := w[t - 16] +% s0 +% w[t - 7] +% s1;
        t += 1;
      };
      var a = h[0];
      var b = h[1];
      var c = h[2];
      var d = h[3];
      var e = h[4];
      var f = h[5];
      var g = h[6];
      var hh = h[7];
      t := 0;
      while (t < 64) {
        let bigS1 = (e <>> 6) ^ (e <>> 11) ^ (e <>> 25);
        let ch = (e & f) ^ ((^e) & g);
        let t1 = hh +% bigS1 +% ch +% K[t] +% w[t];
        let bigS0 = (a <>> 2) ^ (a <>> 13) ^ (a <>> 22);
        let maj = (a & b) ^ (a & c) ^ (b & c);
        let t2 = bigS0 +% maj;
        hh := g;
        g := f;
        f := e;
        e := d +% t1;
        d := c;
        c := b;
        b := a;
        a := t1 +% t2;
        t += 1;
      };
      h[0] := h[0] +% a;
      h[1] := h[1] +% b;
      h[2] := h[2] +% c;
      h[3] := h[3] +% d;
      h[4] := h[4] +% e;
      h[5] := h[5] +% f;
      h[6] := h[6] +% g;
      h[7] := h[7] +% hh;
      off += 64;
    };

    let out = VarArray.repeat<Nat8>(0, 32);
    var k = 0;
    while (k < 8) {
      out[4 * k] := Nat32.toNat8(h[k] >> 24);
      out[4 * k + 1] := Nat32.toNat8((h[k] >> 16) & 0xff);
      out[4 * k + 2] := Nat32.toNat8((h[k] >> 8) & 0xff);
      out[4 * k + 3] := Nat32.toNat8(h[k] & 0xff);
      k += 1;
    };
    out.toArray<Nat8>();
  };

  /// The digest of a Blob, as a Blob.
  public func digestBlob(data : Blob) : Blob = digest(data.toArray()).toBlob();

  let HEX : [Char] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];

  /// Lowercase hexadecimal of bytes.
  public func toHex(bytes : [Nat8]) : Text {
    var s = "";
    for (x in bytes.values()) {
      let v = x.toNat();
      s := s # HEX[v / 16].toText() # HEX[v % 16].toText();
    };
    s;
  };

  func nibble(c : Char) : ?Nat {
    if (c >= '0' and c <= '9') return ?Nat32.toNat(c.toNat32() - 0x30);
    if (c >= 'a' and c <= 'f') return ?Nat32.toNat(c.toNat32() - 0x61 + 10);
    null;
  };

  /// Bytes of a lowercase hexadecimal text; null when the text is not one.
  public func fromHex(t : Text) : ?[Nat8] {
    let cs = t.toArray();
    if (cs.size() % 2 != 0) return null;
    let out = VarArray.repeat<Nat8>(0, cs.size() / 2);
    var i = 0;
    while (i < out.size()) {
      switch (nibble(cs[2 * i]), nibble(cs[2 * i + 1])) {
        case (?hi, ?lo) { out[i] := Nat.toNat8(hi * 16 + lo) };
        case _ { return null };
      };
      i += 1;
    };
    ?out.toArray<Nat8>();
  };
};
