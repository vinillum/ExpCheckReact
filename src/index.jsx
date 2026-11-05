import React from "react";
import { createRoot } from "react-dom/client";
import SearchBox from "./SearchBox";
import ApiBox from "./ApiBox";
import SearchHeaders from "./SearchHeaders";
import Spinner from "./Spinner";
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
    // why a failed request is being asked again, while it waits ("" = none). Only
    // shown while fetching, and reset when a fetch starts.
    fetchRetry: "",
  };

  // `username` is the account the fetch was started for, which is not
  // necessarily the one on screen by the time it finishes.
  callback = (username, data, success, reason) => {
    if (success) {
      try {
        storage.updateHistory(username, data);
      } catch (e) {
        // e.g. localStorage is full: the result could not be kept
        success = false;
      }
    }

    const sameAccount =
      username.toLowerCase() === this.state.username.toLowerCase();
    if (!sameAccount) {
      // The user switched accounts mid-fetch. Any result is already saved under
      // the right account; leave the screen, which shows another one, alone.
      this.setState({
        fetching: false,
        fetchMessage: "Fetch updates...",
        fetchColor: "green",
      });
      return;
    }

    if (success) {
      this.retrieveData(this.state.username);
    }
    this.setState({
      fetching: false,
      fetchMessage: success
        ? "Expansions updated. Fetch again..."
        : reason
        ? `Failed to fetch updates: ${reason}. Try again...`
        : "Failed to fetch updates. Try again...",
      fetchColor: success ? "green" : "red",
    });
  };

  // The history is local, so it needs a username but no token.
  retrieveData = (username) => {
    const headers = username ? storage.getHistory(username) : [];
    this.setState((state) =>
      // While a fetch is running, keep its progress message on screen.
      state.fetching
        ? { headers }
        : { headers, fetchMessage: "Fetch updates...", fetchColor: "green" }
    );
  };

  setUser = (username) => {
    username = username.trim();
    this.setState({ username }, () => {
      this.retrieveData(username);
    });
  };

  setToken = (token) => {
    // A pasted token often carries a stray space; one made only of spaces is
    // no token at all.
    token = token.trim();
    this.setState({ token }, () => {
      this.retrieveData(this.state.username);
    });
  };

  // `username` is the account the fetch was started for, as in callback.
  showProgress = (username, batch, total) => {
    this.setState({
      fetchMessage: `Fetching new data for ${username} (batch ${batch} of ${total})`,
    });
  };

  showRetry = (note) => {
    this.setState({ fetchRetry: note || "" });
  };

  fetchNewData = () => {
    // Capture now: the user may edit the fields while the fetch is running.
    const { username, token } = this.state;
    if (!username || !token) return; // the button is disabled then; be safe anyway
    // Name the account: if the user switches to another one while this runs, the
    // fetch button stays disabled and this says why.
    this.setState({
      fetching: true,
      fetchMessage: `Fetching new data for ${username}`,
      fetchRetry: "",
    });
    search.search(
      username,
      token,
      (data, success, reason) => this.callback(username, data, success, reason),
      (batch, total) => this.showProgress(username, batch, total),
      this.showRetry
    );
  };

  render() {
    const { username, token, fetching } = this.state;
    // Fetching needs both. Without them the button stays visible, greyed out
    // and inert, and says what is missing; the local history still works.
    const canFetch = Boolean(username && token);
    let label = this.state.fetchMessage;
    if (fetching && this.state.fetchRetry) {
      label = `${label} - ${this.state.fetchRetry}`;
    }
    if (!canFetch && !fetching) {
      label = !username
        ? "Enter a username to fetch updates"
        : "Enter an API token to fetch updates";
    }
    return (
      <div className="ui container">
        <SearchBox onSubmit={this.setUser} />
        <ApiBox onSubmit={this.setToken} />
        <h3
          className={`ui block header${canFetch ? "" : " disabled"}`}
          role="button"
          aria-disabled={!canFetch || fetching}
          style={
            canFetch
              ? { backgroundColor: this.state.fetchColor }
              : { backgroundColor: "#e0e1e2", cursor: "not-allowed" }
          }
          onClick={canFetch && !fetching ? this.fetchNewData : undefined}
        >
          {/* the button is grey, not green or red, if the token was cleared mid-fetch */}
          {fetching ? <Spinner inverted={canFetch} /> : null}
          {label}
        </h3>
        <SearchHeaders
          // A new account starts with a clean list: no open entry, and no
          // late result from the previous account's lookup. Lower case, like
          // the history itself, so "Foo" and "foo" are the same account.
          key={this.state.username.toLowerCase()}
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
