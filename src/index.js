import React from "react";
import { createRoot } from "react-dom/client";
import SearchBox from "./SearchBox";
import ApiBox from "./ApiBox";
import SearchHeaders from "./SearchHeaders";
import search from "./search";
import storage from "./storage";

class App extends React.Component {
  state = {
    headers: [],
    username: "",
    token: "",
    fetching: false,
    fetchMessage: "Fetch updates...",
    fetchColor: "green",
  };

  callback = (data, success) => {
    if (success) {
      storage.updateHistory(this.state.username, data);
      this.retrieveData(this.state.username, this.state.token);
    }
    this.setState({
      fetching: false,
      fetchMessage: success
        ? "Expansions updated. Fetch again..."
        : "Failed to fetch updates. Try again...",
      fetchColor: success ? "green" : "red",
    });
  };

  retrieveData = (username, token) => {
    console.log(`retrieveData ${username}, ${token}`);
    if (username && token) {
      this.setState({
        headers: storage.getHistory(username),
        fetchMessage: "Fetch updates...",
        fetchColor: "green",
      });
    } else {
      this.setState({
        headers: [],
        fetchMessage: "Fetch updates...",
        fetchColor: "green",
      });
    }
  };

  setUser = (username) => {
    console.log("setUser", username);
    this.setState({ username }, () => {
      this.retrieveData(username, this.state.token);
    });
  };

  setToken = (token) => {
    console.log("setToken", token);
    this.setState({ token }, () => {
      this.retrieveData(this.state.username, token);
    });
  };

  fetchNewData = () => {
    this.setState({ fetching: true, fetchMessage: "Fetching new data" });
    search.search(this.state.username, this.state.token, this.callback);
  };

  render() {
    return (
      <div className="ui container">
        <SearchBox onSubmit={this.setUser} />
        <ApiBox onSubmit={this.setToken} />
        {this.state.username && this.state.token ? (
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
          token={this.state.token}
        />
      </div>
    );
  }
}

const root = createRoot(document.querySelector("#root"));
root.render(<App />);
