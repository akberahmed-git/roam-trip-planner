// Deprecated - replaced by interestSuggestions.js. The old approach checked
// a fixed "universal" base list for per-destination availability, which
// broke down for categories that aren't just occasionally unavailable but
// genuinely inappropriate for a whole class of destination (e.g. "Bars" in
// much of the Muslim world). interestSuggestions.js generates the full chip
// set per destination instead, so nothing needs a fallback filter.
//
// Left in place rather than deleted (file deletion isn't available in this
// environment) - nothing in the app imports from this file anymore. See
// interestSuggestions.js for the current implementation.
