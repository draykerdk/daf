/// Ledger — the standing of each holder, folded from events v1.
///
/// Same semantics as `foldEvents` in `tools/lib/events.js`:
///   - a holder is listed once a unit.recorded, function.delivered,
///     module.completed or penalty names it, even with no earlier
///     unit.recorded; then its joined and kind are empty;
///   - points come from function.delivered, module.completed and penalty;
///   - joined is the cycle of the holder's latest unit.recorded, and kind the
///     value of that event; a later unit.recorded keeps points and activity;
///   - a holder is active if it cast a vote, or delivered a function, in one
///     of the last `dormantAfter` closed assemblies (assembly.closed events).
///     Activity in an assembly that is not closed yet does not count, as in
///     the reference.
///
/// A vote.cast alone does not list its holder, as in the reference: the vote
/// is kept as activity, and counts if a later event lists that holder. No
/// event is rejected for its holder; only the shape and chain checks of
/// `Event.next` reject a batch.
///
/// The fold is incremental. `State` is an immutable value: `apply` returns a
/// new state per event, so a caller can abandon a batch by keeping the old one.

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
    /// True once an event other than vote.cast names the holder; only listed
    /// holders appear in the standing.
    listed : Bool;
    /// The value of the latest unit.recorded; empty when not recorded.
    kind : Text;
    points : Int;
    /// The cycle of the latest unit.recorded; empty when not recorded.
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

  public type Standing = { id : Text; kind : Text; points : Int; joined : Text; active : Bool };

  public func empty() : State = { holders = Map.empty<Text, Holder>(); closed = 0 };

  let NEW : Holder = { listed = false; kind = ""; points = 0; joined = ""; lastActive = null; activeBefore = null };

  /// The holder, created on first sight.
  func get(s : State, id : Text) : Holder {
    switch (s.holders.get(Text.compare, id)) {
      case (?h) h;
      case null NEW;
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

  /// Fold one event into the state. Never fails: an event that reaches this
  /// point has passed `Event.next`.
  public func apply(s : State, e : Event.EventV1) : State {
    switch (e.kind) {
      case "unit.recorded" {
        put(s, e.holder, { get(s, e.holder) with listed = true; joined = e.cycle; kind = e.value });
      };
      case "function.delivered" {
        let h = get(s, e.holder);
        put(s, e.holder, touch({ h with listed = true; points = h.points + e.points }, s.closed));
      };
      case ("module.completed" or "penalty") {
        let h = get(s, e.holder);
        put(s, e.holder, { h with listed = true; points = h.points + e.points });
      };
      case "vote.cast" put(s, e.holder, touch(get(s, e.holder), s.closed));
      case "assembly.closed" ({ holders = s.holders; closed = s.closed + 1 });
      case _ s;
    };
  };

  /// Fold events given in order, without checking the chain. For a log that
  /// was checked when it was appended.
  public func fold(events : Iter.Iter<Event.EventV1>) : State {
    var st = empty();
    for (e in events) { st := apply(st, e) };
    st;
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
      st := apply(st, e);
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

  /// Every listed holder, by points (descending) then id, as the reference
  /// sorts them. The reference's totals are not computed here.
  public func standing(s : State, dormantAfter : Nat) : [Standing] {
    let rows = s.holders.entries().filter(func((_, h) : (Text, Holder)) : Bool = h.listed).map<(Text, Holder), Standing>(
      func((id, h)) = { id; kind = h.kind; points = h.points; joined = h.joined; active = isActive(h, s.closed, dormantAfter) }
    ).toArray();
    rows.sort(byStanding);
  };
};
