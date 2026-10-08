/// Event — the canonical event log, version 1 (`daf-event/1`), in Motoko.
///
/// Mirrors `tools/lib/events.js`: the same fields, the same preimage byte for
/// byte, the same SHA-256 hash and the same chain rule. The JavaScript is the
/// reference; the vectors in `icp/test/vectors.json` are derived from it and
/// the tests fail on any difference.
///
/// Preimage of one event (ASCII, lines joined with \n, final \n):
///
///   daf-event/1
///   seq=<n>
///   kind=<kind>
///   cycle=<YYYY-MM>
///   holder=<id or empty>
///   points=<0 | -?[1-9][0-9]*>
///   value=<value or empty>
///   ref=<repo-relative path>
///   blob=<40 hex, or empty>
///   evidence=<count>
///   evidence=<url>            (count lines)
///   prev=<64 hex; genesis is 64 zeros>
///
/// The kinds are a closed list. Veto records are not among them and are never
/// accepted here.

import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Char "mo:core/Char";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Text "mo:core/Text";
import Sha256 "Sha256";

module {
  public type EventV1 = {
    seq : Nat;
    kind : Text;
    cycle : Text;
    holder : Text;
    points : Int;
    value : Text;
    ref : Text;
    blob : Text;
    evidence : [Text];
    prev : Text;
  };

  public let HEADER : Text = "daf-event/1";

  /// The `prev` of the first event, and the head of an empty log.
  public let ZERO : Text = "0000000000000000000000000000000000000000000000000000000000000000";

  /// The kinds of version 1. No veto kind, by design.
  public let KINDS : [Text] = [
    "unit.recorded",
    "function.delivered",
    "module.completed",
    "penalty",
    "request.decided",
    "vote.cast",
    "steward.intervention",
    "assembly.closed",
  ];

  /// The largest magnitude of `points` that the JavaScript reference prints in
  /// plain decimal (Number.MAX_SAFE_INTEGER). Beyond it the two would disagree.
  public let MAX_POINTS : Nat = 9_007_199_254_740_991;

  /// The preimage text of one event.
  public func preimage(e : EventV1) : Text {
    var s = HEADER # "\n" # "seq=" # e.seq.toText() # "\n" # "kind=" # e.kind # "\n" # "cycle=" # e.cycle # "\n" # "holder=" # e.holder # "\n" # "points=" # e.points.toText() # "\n" # "value=" # e.value # "\n" # "ref=" # e.ref # "\n" # "blob=" # e.blob # "\n" # "evidence=" # e.evidence.size().toText() # "\n";
    for (u in e.evidence.values()) { s := s # "evidence=" # u # "\n" };
    s # "prev=" # e.prev # "\n";
  };

  /// Lowercase hex SHA-256 of the UTF-8 preimage.
  public func hash(e : EventV1) : Text {
    Sha256.toHex(Sha256.digest(preimage(e).encodeUtf8().toArray()));
  };

  /// The 32 raw bytes of a head given in hex, or null if it is not 64 lowercase hex.
  public func headBytes(head : Text) : ?Blob {
    if (not isHex(head, 64)) return null;
    switch (Sha256.fromHex(head)) {
      case (?b) ?b.toBlob();
      case null null;
    };
  };

  func printable(t : Text) : Bool {
    for (c in t.chars()) {
      let n = c.toNat32();
      if (n < 0x21 or n > 0x7e) return false;
    };
    true;
  };

  func isHexChar(c : Char) : Bool = (c >= '0' and c <= '9') or (c >= 'a' and c <= 'f');

  func isHex(t : Text, len : Nat) : Bool {
    if (t.size() != len) return false;
    for (c in t.chars()) { if (not isHexChar(c)) return false };
    true;
  };

  func isDigit(c : Char) : Bool = c >= '0' and c <= '9';

  /// YYYY-MM with a month from 01 to 12.
  func isCycle(t : Text) : Bool {
    let cs = t.toArray();
    if (cs.size() != 7) return false;
    if (not (isDigit(cs[0]) and isDigit(cs[1]) and isDigit(cs[2]) and isDigit(cs[3]) and cs[4] == '-' and isDigit(cs[5]) and isDigit(cs[6]))) return false;
    if (cs[5] == '0') return cs[6] != '0';
    cs[5] == '1' and (cs[6] == '0' or cs[6] == '1' or cs[6] == '2');
  };

  func knownKind(k : Text) : Bool {
    for (x in KINDS.values()) { if (x == k) return true };
    false;
  };

  /// The field shapes of one event, in the order of the JavaScript
  /// `shapeError`; null when the event is well formed.
  public func validate(e : EventV1) : ?Text {
    if (e.seq < 1) return ?"seq must be a positive integer";
    if (not knownKind(e.kind)) return ?("unknown kind \"" # e.kind # "\"");
    if (not isCycle(e.cycle)) return ?"cycle must be YYYY-MM";
    if (Int.abs(e.points) > MAX_POINTS) return ?"points must be an integer the reference prints in decimal (at most 2^53 - 1 in magnitude)";
    if (not (e.blob == "" or isHex(e.blob, 40))) return ?"blob must be 40 lowercase hex or empty";
    if (not isHex(e.prev, 64)) return ?"prev must be 64 lowercase hex";
    for ((k, v) in [("holder", e.holder), ("value", e.value), ("ref", e.ref), ("blob", e.blob), ("cycle", e.cycle), ("kind", e.kind)].values()) {
      if (not printable(v)) return ?(k # " \"" # v # "\" is not printable ASCII without spaces");
    };
    if (e.ref == "") return ?"ref must not be empty";
    for (u in e.evidence.values()) {
      if (u == "" or not printable(u)) return ?("evidence \"" # u # "\" is not printable ASCII without spaces");
    };
    null;
  };

  /// Check that `e` extends a chain whose last event has `seq` and hash `head`,
  /// and return the hash of `e`, which becomes the new head.
  public func next(seq : Nat, head : Text, e : EventV1) : Result.Result<Text, Text> {
    let at = "event " # e.seq.toText() # ": ";
    switch (validate(e)) {
      case (?err) return #err(at # err);
      case null {};
    };
    if (e.seq != seq + 1) return #err(at # "seq must be " # (seq + 1).toText());
    if (e.prev != head) return #err(at # "prev does not match the previous hash");
    #ok(hash(e));
  };

  /// Verify a whole chain from genesis; returns the head.
  public func verifyChain(events : [EventV1]) : Result.Result<Text, Text> {
    var head = ZERO;
    var seq = 0;
    for (e in events.values()) {
      switch (next(seq, head, e)) {
        case (#err(m)) return #err(m);
        case (#ok(h)) { head := h };
      };
      seq += 1;
    };
    #ok(head);
  };
};
