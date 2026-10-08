/// Ledger — the standing of each holder, folded from events v1.
///
/// Same semantics as `foldEvents` in `tools/lib/events.js`:
///   - points come from function.delivered, module.completed and penalty;
///   - joined is the cycle of the holder's unit.recorded;
///   - a holder is active if it cast a vote, or delivered a function, in one
///     of the last `dormantAfter` closed assemblies (assembly.closed events).
///     Activity in an assembly that is not closed yet does not count, as in
///     the reference.
///
/// One rule is stricter than the reference, which trusts its input: an event
/// that changes points (function.delivered, module.completed, penalty) or a
/// vote.cast for a holder with no earlier unit.recorded is rejected.
///
/// The fold is incremental. `State` is an immutable value: `apply` returns a
/// new state per event, so a caller can abandon a batch by keeping the old one,
/// and no call ever refolds the whole history.

import Array "mo:core/Array";
import Iter "mo:core/Iter";
import Map "mo:core/pure/Map";
import Order "mo:core/Order";
import Result "mo:core/Result";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Event "Event";

module {
  public type Holder = {
    points : Int;
    joined : Text;
    /// Index (from 0) of the latest assembly in which the holder voted or
    /// delivered. That assembly may still be open.
    lastActive : ?Nat;
    /// Index of the latest assembly with activity before `lastActive`; it is
    /// always closed. Needed while `lastActive` is the open assembly.
    activeBefore : ?Nat;
  };

  public type State = {
    holders : Map.Map<Text, Holder>;
    /// Number of assembly.closed events folded so far; also the index of the
    /// assembly that is open.
    closed : Nat;
  };

  public type Standing = { id : Text; points : Int; joined : Text; active : Bool };

  public func empty() : State = { holders = Map.empty<Text, Holder>(); closed = 0 };

  func recorded(s : State, e : Event.EventV1) : Result.Result<Holder, Text> {
    switch (s.holders.get(Text.compare, e.holder)) {
      case (?h) #ok(h);
      case null #err("event " # e.seq.toText() # ": " # e.kind # " for holder \"" # e.holder # "\" without an earlier unit.recorded");
    };
  };

  func put(s : State, id : Text, h : Holder) : State = {
    holders = s.holders.add(Text.compare, id, h);
    closed = s.closed;
  };

  /// Mark activity in the open assembly.
  func touch(h : Holder, open : Nat) : Holder {
    if (h.lastActive == ?open) return h;
    { h with lastActive = ?open; activeBefore = h.lastActive };
  };

  /// Fold one event into the state.
  public func apply(s : State, e : Event.EventV1) : Result.Result<State, Text> {
    switch (e.kind) {
      case "unit.recorded" {
        let h : Holder = switch (s.holders.get(Text.compare, e.holder)) {
          case (?old) { { old with joined = e.cycle } };
          case null { { points = 0; joined = e.cycle; lastActive = null; activeBefore = null } };
        };
        #ok(put(s, e.holder, h));
      };
      case "function.delivered" {
        switch (recorded(s, e)) {
          case (#err(m)) #err(m);
          case (#ok(h)) #ok(put(s, e.holder, touch({ h with points = h.points + e.points }, s.closed)));
        };
      };
      case ("module.completed" or "penalty") {
        switch (recorded(s, e)) {
          case (#err(m)) #err(m);
          case (#ok(h)) #ok(put(s, e.holder, { h with points = h.points + e.points }));
        };
      };
      case "vote.cast" {
        switch (recorded(s, e)) {
          case (#err(m)) #err(m);
          case (#ok(h)) #ok(put(s, e.holder, touch(h, s.closed)));
        };
      };
      case "assembly.closed" #ok({ holders = s.holders; closed = s.closed + 1 });
      case _ #ok(s);
    };
  };

  /// Check that `batch` extends a chain whose last event has `seq` and hash
  /// `head` (seq = last + 1, prev = head, valid shape, hash recomputed) and
  /// fold it into `state`. All or nothing: the first error rejects the batch.
  public func extend(seq : Nat, head : Text, state : State, batch : [Event.EventV1]) : Result.Result<{ seq : Nat; head : Text; state : State }, Text> {
    var n = seq;
    var h = head;
    var st = state;
    for (e in batch.values()) {
      switch (Event.next(n, h, e)) {
        case (#err(m)) return #err(m);
        case (#ok(x)) { h := x };
      };
      switch (apply(st, e)) {
        case (#err(m)) return #err(m);
        case (#ok(x)) { st := x };
      };
      n += 1;
    };
    #ok({ seq = n; head = h; state = st });
  };

  func isActive(h : Holder, closed : Nat, dormantAfter : Nat) : Bool {
    // The latest closed assembly with activity.
    let last : ?Nat = switch (h.lastActive) {
      case (?i) { if (i < closed) ?i else h.activeBefore };
      case null null;
    };
    switch (last) {
      case (?i) i + dormantAfter >= closed;
      case null false;
    };
  };

  func byStanding(a : Standing, b : Standing) : Order.Order {
    if (a.points > b.points) return #less;
    if (a.points < b.points) return #greater;
    Text.compare(a.id, b.id);
  };

  /// Every holder, by points (descending) then id, as the reference sorts them.
  public func standing(s : State, dormantAfter : Nat) : [Standing] {
    let rows = s.holders.entries().map<(Text, Holder), Standing>(
      func((id, h)) = { id; points = h.points; joined = h.joined; active = isActive(h, s.closed, dormantAfter) }
    ).toArray();
    rows.sort(byStanding);
  };
};
