import React from "react";
import { createRoot } from "react-dom/client";
import SearchBox from "./SearchBox";
import SearchHeaders from "./SearchHeaders";
import search from "./search";
import storage from "./storage";

class App extends React.Component {
  state = {
    headers: [],
    username: "",
    fetching: false,
    fetchMessage: "Fetch updates...",
    fetchColor: "green",
  };

  callback = (data, success) => {
    if (success) {
      storage.updateHistory(this.state.username, data);
      this.retrieveData(this.state.username);
    }
    this.setState({
      fetching: false,
      fetchMessage: success
        ? "Expansions updated. Fetch again..."
        : "Failed to fetch updates. Try again...",
      fetchColor: success ? "green" : "red",
    });
  };

  retrieveData = (username) => {
    this.setState({
      headers: storage.getHistory(username),
      username,
      fetchMessage: "Fetch updates...",
      fetchColor: "green",
    });
  };

  fetchNewData = () => {
    this.setState({ fetching: true, fetchMessage: "Fetching new data" });
    search.search(this.state.username, this.callback);
  };

  render() {
    return (
      <div className="ui container">
        <SearchBox onSubmit={this.retrieveData} />
        {this.state.username ? (
          <h3
            className="ui block header"
            style={{ backgroundColor: this.state.fetchColor }}
            onClick={this.state.fetching ? null : this.fetchNewData}
          >
            {this.state.fetchMessage}
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

const root = createRoot(document.querySelector("#root"));
root.render(<App />);
