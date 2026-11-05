import React from "react";

class ApiBox extends React.Component {
  state = { token: "" };

  componentDidMount() {
    const storedToken = window.localStorage.getItem("API_TOKEN");
    if (storedToken) {
      this.setState({ token: storedToken });
      this.props.onSubmit(storedToken);
    }
  }

  // Called when the field is left or Enter is pressed: only then is the token
  // used and saved. Typing alone neither saves nor sends half a token. Only the
  // trimmed token is stored; an empty one removes the saved value.
  onFormSubmit = (event) => {
    event.preventDefault();
    const token = this.state.token.trim();
    try {
      if (token) window.localStorage.setItem("API_TOKEN", token);
      else window.localStorage.removeItem("API_TOKEN");
    } catch (e) {
      // storage unavailable: the token still works for this page view
    }
    this.props.onSubmit(token);
  };

  onChange = (event) => {
    this.setState({ token: event.target.value });
  };

  render() {
    return (
      <div className="segment">
        <form className="ui form" onSubmit={this.onFormSubmit}>
          <div className="field">
            <label>API Token (optional: needed to fetch updates and to load new items)</label>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={this.state.token}
              onChange={this.onChange}
              onBlur={this.onFormSubmit}
            />
          </div>
        </form>
      </div>
    );
  }
}

export default ApiBox;
