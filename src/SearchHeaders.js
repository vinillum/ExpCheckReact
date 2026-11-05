import React from "react";
import SearchResults from "./SearchResults";
import storage from "./storage";
import search from "./search";

class SearchHeaders extends React.Component {
  // unloaded: how many items of the open entry are neither stored nor loadable
  state = { fetched: "", metadata: [], unloaded: 0, fetching: "", failed: "" };

  componentDidUpdate(prevProps) {
    // The token was entered while an entry with unloaded items is open: load
    // them now instead of making the user close and reopen the entry.
    if (
      !prevProps.token &&
      this.props.token &&
      this.state.fetched &&
      this.state.unloaded > 0 &&
      !this.state.fetching
    ) {
      this.loadEntry(this.state.fetched);
    }
  }

  fetchHistorical = (date) => {
    if (date === this.state.fetched) {
      // Clicking the open entry closes it. What was loaded stays stored, so
      // opening it again needs no request.
      this.setState({ fetched: "", metadata: [], unloaded: 0 });
      return;
    }
    if (this.state.fetching) return;
    return this.loadEntry(date);
  };

  // Shows the entry. Expansions whose details are stored are never requested
  // again; only the missing ones are loaded from BGG, and only with a token.
  // Every batch is stored as it arrives, so a failure part way loses nothing.
  loadEntry = async (date) => {
    const ids = storage.getHistoryIds(this.props.username, date) || [];
    const stored = storage.getDetails(ids);
    const missing = ids.filter((id) => !stored.has(id));
    const show = (details) => {
      const byId = new Map(stored);
      details.forEach((d) => byId.set(d.id, d));
      const metadata = ids.map((id) => byId.get(id)).filter(Boolean);
      this.setState({
        fetching: "",
        failed: "",
        fetched: date,
        metadata,
        unloaded: ids.length - metadata.length,
      });
    };

    if (missing.length === 0 || !this.props.token) {
      show([]); // nothing to ask BGG for, or nothing to ask with
      return;
    }
    this.setState({ fetching: date, failed: "" });
    try {
      show(
        await search.getExpansionDetails(
          missing,
          this.props.token,
          storage.saveDetails
        )
      );
    } catch (e) {
      // Release the lock, otherwise no entry could ever be opened again.
      this.setState({ fetching: "", failed: date });
    }
  };

  label(result) {
    if (this.state.fetching === result) return "Fetching";
    if (this.state.failed === result) {
      return `${result} - failed to load, click to retry`;
    }
    return result;
  }

  render() {
    const results = this.props.results.map((result) => {
      return (
        <div key={result}>
          <h3
            className="ui block header"
            onClick={() => this.fetchHistorical(result)}
          >
            {this.label(result)}
          </h3>
          {this.state.fetched === result ? (
            <SearchResults
              results={this.state.metadata}
              unloaded={this.state.unloaded}
            />
          ) : null}
        </div>
      );
    });
    return <div className="ui middle aligned selection list">{results}</div>;
  }
}

export default SearchHeaders;
