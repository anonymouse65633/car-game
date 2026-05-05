/* ============================================================
   Horizon City — js/firebase/firestore.js
   All Firestore read/write operations for social and
   multiplayer features: leaderboards, convoy lobbies,
   and the auction house.

   Dependencies: firebase.js for the db + currentUser singletons.
   ============================================================ */

import { db, currentUser } from './firebase.js';

// ─── Helpers ─────────────────────────────────────────────────

/** Shorthand: server timestamp via the compat SDK. */
const serverTimestamp = () => firebase.firestore.FieldValue.serverTimestamp();

/** Shorthand: arrayUnion */
const arrayUnion = (...items) => firebase.firestore.FieldValue.arrayUnion(...items);

/** Shorthand: arrayRemove */
const arrayRemove = (...items) => firebase.firestore.FieldValue.arrayRemove(...items);

// ─── Leaderboard ─────────────────────────────────────────────

/**
 * submitLapTime(trackId, carId, timeMs, playerName)
 * Writes the player's best lap to leaderboards/{trackId}/times.
 * Document ID = currentUser.uid so each player has one entry per track
 * (submitting again overwrites — keeps only their personal best).
 * No-ops silently if the player is not signed in.
 */
export async function submitLapTime(trackId, carId, timeMs, playerName) {
  if (!currentUser) return;
  try {
    await db
      .collection('leaderboards')
      .doc(trackId)
      .collection('times')
      .doc(currentUser.uid)
      .set({
        uid:        currentUser.uid,
        playerName,
        carId,
        timeMs,
        timestamp:  serverTimestamp()
      });
  } catch (err) {
    console.error('[Firestore] submitLapTime failed:', err);
    throw err;
  }
}

/**
 * getLeaderboard(trackId, limit)
 * Returns the top N times for a track, ordered fastest first.
 * Each item: { rank, playerName, carId, timeMs, uid }
 */
export async function getLeaderboard(trackId, limit = 10) {
  try {
    const snap = await db
      .collection('leaderboards')
      .doc(trackId)
      .collection('times')
      .orderBy('timeMs', 'asc')
      .limit(limit)
      .get();

    return snap.docs.map((doc, index) => ({
      rank:       index + 1,
      uid:        doc.data().uid,
      playerName: doc.data().playerName,
      carId:      doc.data().carId,
      timeMs:     doc.data().timeMs
    }));
  } catch (err) {
    console.error('[Firestore] getLeaderboard failed:', err);
    throw err;
  }
}

// ─── Convoy (Multiplayer Lobby) ───────────────────────────────

/**
 * createConvoy(hostName, maxPlayers)
 * Creates a new convoy lobby document in the convoys/ collection.
 * Returns the new convoy document ID.
 */
export async function createConvoy(hostName, maxPlayers = 8) {
  if (!currentUser) throw new Error('Must be signed in to create a convoy.');
  try {
    const ref = await db.collection('convoys').add({
      hostUid:    currentUser.uid,
      hostName,
      maxPlayers,
      players: [{
        uid:   currentUser.uid,
        name:  hostName,
        carId: null,
        ready: false
      }],
      status:    'waiting',
      createdAt: serverTimestamp(),
      region:    'auto'
    });
    return ref.id;
  } catch (err) {
    console.error('[Firestore] createConvoy failed:', err);
    throw err;
  }
}

/**
 * joinConvoy(convoyId, playerName, carId)
 * Joins an existing convoy lobby.
 * Throws if the lobby is full or not in 'waiting' status.
 * Returns the convoy data on success.
 */
export async function joinConvoy(convoyId, playerName, carId) {
  if (!currentUser) throw new Error('Must be signed in to join a convoy.');
  try {
    const ref = db.collection('convoys').doc(convoyId);
    const doc = await ref.get();

    if (!doc.exists) throw new Error('Convoy not found.');

    const data = doc.data();
    if (data.status !== 'waiting') throw new Error('Convoy is no longer accepting players.');
    if (data.players.length >= data.maxPlayers) throw new Error('Convoy is full.');

    const newPlayer = {
      uid:   currentUser.uid,
      name:  playerName,
      carId,
      ready: false
    };

    await ref.update({ players: arrayUnion(newPlayer) });
    return { ...data, players: [...data.players, newPlayer] };
  } catch (err) {
    console.error('[Firestore] joinConvoy failed:', err);
    throw err;
  }
}

/**
 * listenToConvoy(convoyId, onUpdate)
 * Attaches a real-time listener to the convoy document.
 * Calls onUpdate(convoyData) each time the document changes.
 * Returns the unsubscribe function — caller must invoke it on cleanup.
 */
export function listenToConvoy(convoyId, onUpdate) {
  const unsubscribe = db
    .collection('convoys')
    .doc(convoyId)
    .onSnapshot((doc) => {
      if (doc.exists) {
        onUpdate(doc.data());
      }
    }, (err) => {
      console.error('[Firestore] listenToConvoy error:', err);
    });

  return unsubscribe;
}

/**
 * leaveConvoy(convoyId)
 * Removes the current user's player entry from the convoy.
 */
export async function leaveConvoy(convoyId) {
  if (!currentUser) return;
  try {
    const ref  = db.collection('convoys').doc(convoyId);
    const doc  = await ref.get();
    if (!doc.exists) return;

    const data        = doc.data();
    const playerEntry = data.players.find((p) => p.uid === currentUser.uid);
    if (!playerEntry) return;

    await ref.update({ players: arrayRemove(playerEntry) });
  } catch (err) {
    console.error('[Firestore] leaveConvoy failed:', err);
    throw err;
  }
}

/**
 * setConvoyReady(convoyId, ready)
 * Toggles the ready flag on the current user's entry in the players array.
 * Reads the current array, updates in place, and writes back the full array
 * (Firestore doesn't support updating nested array element fields directly).
 */
export async function setConvoyReady(convoyId, ready) {
  if (!currentUser) return;
  try {
    const ref  = db.collection('convoys').doc(convoyId);
    const doc  = await ref.get();
    if (!doc.exists) return;

    const players = doc.data().players.map((p) =>
      p.uid === currentUser.uid ? { ...p, ready } : p
    );

    await ref.update({ players });
  } catch (err) {
    console.error('[Firestore] setConvoyReady failed:', err);
    throw err;
  }
}

// ─── Auction House ────────────────────────────────────────────

/**
 * listCarForAuction(carId, carDef, startPrice, durationHours)
 * Lists a car on the auction house.
 * Returns the new auction document ID.
 */
export async function listCarForAuction(carId, carDef, startPrice, durationHours) {
  if (!currentUser) throw new Error('Must be signed in to list an auction.');
  try {
    const endsAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

    const ref = await db.collection('auctions').add({
      sellerId:    currentUser.uid,
      sellerName:  currentUser.displayName ?? currentUser.email ?? 'Unknown',
      carId,
      carDef,               // snapshot of car data at time of listing
      startPrice,
      currentBid:  startPrice,
      highBidder:  null,
      endsAt:      firebase.firestore.Timestamp.fromDate(endsAt),
      status:      'active',
      createdAt:   serverTimestamp()
    });
    return ref.id;
  } catch (err) {
    console.error('[Firestore] listCarForAuction failed:', err);
    throw err;
  }
}

/**
 * placeBid(auctionId, bidAmount)
 * Places a bid using a Firestore transaction to prevent race conditions.
 * Throws if the bid is too low or the auction has ended.
 */
export async function placeBid(auctionId, bidAmount) {
  if (!currentUser) throw new Error('Must be signed in to place a bid.');
  try {
    await db.runTransaction(async (transaction) => {
      const ref = db.collection('auctions').doc(auctionId);
      const doc = await transaction.get(ref);

      if (!doc.exists) throw new Error('Auction not found.');

      const data = doc.data();
      if (data.status !== 'active') throw new Error('Auction is no longer active.');
      if (data.endsAt.toDate() <= new Date()) throw new Error('Auction has already ended.');
      if (bidAmount <= data.currentBid) {
        throw new Error(`Bid must be higher than current bid of CR ${data.currentBid}.`);
      }

      transaction.update(ref, {
        currentBid: bidAmount,
        highBidder: {
          uid:  currentUser.uid,
          name: currentUser.displayName ?? currentUser.email ?? 'Unknown'
        }
      });
    });
  } catch (err) {
    console.error('[Firestore] placeBid failed:', err);
    throw err;
  }
}

/**
 * getActiveAuctions(limit)
 * Returns active auctions ordered by ending soonest first.
 * Each item includes the document ID as auctionId.
 */
export async function getActiveAuctions(limit = 20) {
  try {
    const now  = firebase.firestore.Timestamp.now();
    const snap = await db
      .collection('auctions')
      .where('status', '==', 'active')
      .where('endsAt', '>', now)
      .orderBy('endsAt', 'asc')
      .limit(limit)
      .get();

    return snap.docs.map((doc) => ({ auctionId: doc.id, ...doc.data() }));
  } catch (err) {
    console.error('[Firestore] getActiveAuctions failed:', err);
    throw err;
  }
}

/**
 * claimAuctionWin(auctionId)
 * Called by the auction winner to claim their car.
 * Validates winner identity, auction end time, and status.
 * Marks the auction as 'claimed' and returns the carDef
 * so the caller can add it to the player's garage.
 */
export async function claimAuctionWin(auctionId) {
  if (!currentUser) throw new Error('Must be signed in to claim an auction win.');
  try {
    const ref  = db.collection('auctions').doc(auctionId);
    const doc  = await ref.get();

    if (!doc.exists) throw new Error('Auction not found.');

    const data = doc.data();

    if (data.status !== 'active')                          throw new Error('Auction already claimed or cancelled.');
    if (data.endsAt.toDate() > new Date())                 throw new Error('Auction has not ended yet.');
    if (!data.highBidder)                                  throw new Error('No bids were placed on this auction.');
    if (data.highBidder.uid !== currentUser.uid)           throw new Error('You are not the winning bidder.');

    await ref.update({ status: 'claimed' });

    return data.carDef;
  } catch (err) {
    console.error('[Firestore] claimAuctionWin failed:', err);
    throw err;
  }
}
