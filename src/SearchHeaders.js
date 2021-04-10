import React from "react";
import SearchResults from "./SearchResults";
import storage from "./storage";
import search from "./search";

class SearchHeaders extends React.Component {
  state = { fetched: "", metadata: [], fetching: false };

  fetchHistorical = async (date) => {
    this.setState({ fetching: true });
    let ids = storage.getHistoryIds(this.props.username, date);
    let results = await search.searchExpansions(
      ids,
      search.filterNewExpansions
    );
    this.setState({ fetching: false, metadata: results, fetched: date });
  };

  render() {
    const results = this.props.results.map((result) => {
      return (
        <div key={result}>
          <h3
            className="ui block header"
            onClick={() => this.fetchHistorical(result)}
          >
            {result}
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
