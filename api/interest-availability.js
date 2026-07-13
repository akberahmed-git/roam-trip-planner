// Deprecated - replaced by /api/interest-suggestions.js (see
// _lib/interestSuggestions.js). Left in place rather than deleted (file
// deletion isn't available in this environment); TripInput.jsx no longer
// calls this route.
export default async function handler(req, res) {
  res.status(410).json({ error: 'This endpoint has been replaced by /api/interest-suggestions.' });
}
