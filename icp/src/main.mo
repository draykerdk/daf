/// The federation record as a canister: wiring only.
///
/// Preparation, not a deployment. Nothing here is installed anywhere, and
/// nothing depends on it; see `icp/README.md`. The canister would keep the
/// event log v1, its head and the standing folded from it. The head is
/// certified; the standing is a convenience that a client checks by replaying
/// the events up to the certified head.
///
/// Motoko does not let a public method share its name with a field, so the
/// state fields are `log`, `currentHead` and `standing`, behind the methods
/// `events`, `head` and `ledger`.

import CertifiedData "mo:core/CertifiedData";
import List "mo:core/pure/List";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Result "mo:core/Result";
import Event "Event";
import Ledger "Ledger";

actor Federation {
  /// One stored event. The variant leaves room for later versions of the log.
  type Stored = { #v1 : Event.EventV1 };

  transient let MAX_BATCH = 500;
  transient let MAX_PAGE = 100;

  /// DAF-000 §3.4, as `federation/parameters.yml` states it today. A change of
  /// that parameter needs a new build of this canister.
  transient let DORMANT_AFTER = 3;

  /// The events, newest first (an immutable list, so its stable type is plain
  /// data and does not depend on the layout of a growable container).
  var log : List.List<Stored> = List.empty();
  /// Number of events in `log`; the seq of the newest one.
  var count : Nat = 0;
  var currentHead : Text = Event.ZERO;
  var standing : Ledger.State = Ledger.empty();

  /// Reserved for a later, narrower appender than the controllers. No method
  /// sets it in this preparation, and `append` does not read it.
  var appender : ?Principal = null;

  func certify() {
    switch (Event.headBytes(currentHead)) {
      case (?bytes) CertifiedData.set(bytes);
      case null {};
    };
  };

  /// Append a batch of events. All or nothing: any error rejects the whole
  /// batch and leaves the state as it was.
  public shared ({ caller }) func append(batch : [Event.EventV1]) : async Result.Result<{ seq : Nat; head : Text }, Text> {
    if (not caller.isController()) return #err("only a controller of this canister can append");
    if (batch.size() > MAX_BATCH) return #err("at most " # MAX_BATCH.toText() # " events per call");
    switch (Ledger.extend(count, currentHead, standing, batch)) {
      case (#err(m)) #err(m);
      case (#ok(r)) {
        for (e in batch.values()) { log := log.pushFront(#v1(e)) };
        count := r.seq;
        currentHead := r.head;
        standing := r.state;
        certify();
        #ok({ seq = r.seq; head = r.head });
      };
    };
  };

  /// The seq and hash of the newest event, with the certificate whose
  /// certified data is the 32 bytes of that hash.
  public query func head() : async { seq : Nat; head : Text; certificate : ?Blob } {
    { seq = count; head = currentHead; certificate = CertifiedData.getCertificate() };
  };

  /// Events in order from seq `from` (0 is read as 1), at most 100 per call.
  public query func events(from : Nat, limit : Nat) : async [Event.EventV1] {
    let first = Nat.max(from, 1);
    if (first > count) return [];
    // Both differences are safe: first <= count and first + n <= count + 1.
    let n = Nat.min(Nat.min(limit, MAX_PAGE), Nat.sub(count + 1, first));
    if (n == 0) return [];
    let newer = Nat.sub(count + 1, first + n);
    let page = log.drop(newer).take(n).reverse();
    page.map<Stored, Event.EventV1>(func(s) { switch s { case (#v1(e)) e } }).toArray();
  };

  /// The standing folded from the events. Not certified: a client that needs
  /// assurance replays the events up to the certified head.
  public query func ledger() : async [{ id : Text; points : Int; joined : Text; active : Bool }] {
    Ledger.standing(standing, DORMANT_AFTER);
  };

  system func postupgrade() {
    certify();
  };
};
