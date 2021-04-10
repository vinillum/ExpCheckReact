import React from "react";
import ReactDOM from "react-dom";
import SearchBox from "./SearchBox";
import SearchHeaders from "./SearchHeaders";
import search from "./search";
import storage from "./storage";

class App extends React.Component {
  state = { headers: [], username: "", fetching: false };

  callback = (data) => {
    storage.updateHistory(this.state.username, data);
    this.retrieveData(this.state.username);
    this.setState({ fetching: false });
  };

  retrieveData = (username) => {
    this.setState({ headers: storage.getHistory(username), username });
  };

  fetchNewData = () => {
    this.setState({ fetching: true });
    search.search(this.state.username, this.callback);
  };

  render() {
    return (
      <div className="ui container">
        <SearchBox onSubmit={this.retrieveData} />
        {this.state.username ? (
          <h3
            className="ui block header"
            onClick={this.state.fetching ? null : this.fetchNewData}
          >
            Fetch updates
          </h3>
        ) : null}
        <SearchHeaders
          results={this.state.headers}
          username={this.state.username}
        />
      </div>
    );
  }
}

ReactDOM.render(<App />, document.querySelector("#root"));
