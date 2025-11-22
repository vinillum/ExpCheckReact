import React from "react";
import SearchResults from "./SearchResults";
import storage from "./storage";
import search from "./search";

class SearchHeaders extends React.Component {
  state = { fetched: "", metadata: [], fetching: "" };

  fetchHistorical = async (date) => {
    if (date === this.state.fetched) return;
    if (this.state.fetching) return;
    this.setState({ fetching: date });
    let ids = storage.getHistoryIds(this.props.username, date);
    let results = await search.searchExpansions(
      ids,
      this.props.token,
      search.filterNewExpansions
    );
    this.setState({ fetching: "", metadata: results, fetched: date });
  };

  render() {
    const results = this.props.results.map((result) => {
      return (
        <div key={result}>
          <h3
            className="ui block header"
            onClick={() => this.fetchHistorical(result)}
          >
            {this.state.fetching === result ? "Fetching" : result}
          </h3>
          {this.state.fetched === result ? (
            <SearchResults results={this.state.metadata} />
          ) : null}
        </div>
      );
    });
    return <div className="ui middle aligned selection list">{results}</div>;
  }
}

export default SearchHeaders;
