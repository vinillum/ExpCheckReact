import React from "react";

class SearchResults extends React.Component {
  render() {
    // `unloaded`: items of this entry whose name and cover are not stored yet
    // and could not be loaded (there is no API token, or the request failed).
    const { results, unloaded = 0 } = this.props;
    const note =
      unloaded > 0 ? (
        <div className="ui message">
          {unloaded === 1
            ? "1 item is not loaded yet. Enter an API token to load it."
            : `${unloaded} items are not loaded yet. Enter an API token to load them.`}
        </div>
      ) : null;
    if (results.length === 0) {
      return note || <div>No new expansions found</div>;
    }
    const items = results.map((result) => {
      const content = (
        <>
          <img className="ui image" src={result.thumbnail} alt={result.name} />
          <div className="content">
            <div className="ui medium header">{result.name}</div>
          </div>
        </>
      );
      // A real link: it can be reached with the keyboard, opened in a new tab
      // with the middle button, and noopener keeps the new page from reaching
      // back into this one. The id comes from BGG's response, so only a plain
      // number is turned into a link.
      return /^\d+$/.test(result.id) ? (
        <a
          className="item"
          key={result.id}
          href={`https://www.boardgamegeek.com/boardgame/${result.id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {content}
        </a>
      ) : (
        <div className="item" key={result.id}>
          {content}
        </div>
      );
    });
    return (
      <div>
        {note}
        <div className="ui middle aligned selection list">{items}</div>
      </div>
    );
  }
}

export default SearchResults;
