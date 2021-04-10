import React from "react";

class SearchResults extends React.Component {
  render() {
    if (this.props.results.length === 0) {
      return <div>No new expansions found</div>;
    }
    const results = this.props.results.map((result) => {
      return (
        <div
          className="item"
          key={result.id}
          onClick={() =>
            window.open(`https://www.boardgamegeek.com/boardgame/${result.id}`)
          }
        >
          <img className="ui image" src={result.thumbnail} alt={result.name} />
          <div className="content">
            <div className="ui medium header">{result.name}</div>
          </div>
        </div>
      );
    });
    return <div className="ui middle aligned selection list">{results}</div>;
  }
}

export default SearchResults;
