import React from "react";

class SearchBox extends React.Component {
  state = { username: "" };

  componentDidMount() {
    const storedUser = window.localStorage.getItem("USERNAME");
    if (storedUser) {
      this.setState({ username: storedUser });
      this.props.onSubmit(storedUser);
    }
  }

  onFormSubmit = (event) => {
    event.preventDefault();
    this.props.onSubmit(this.state.username);
  };

  onChange = (event) => {
    this.setState({ username: event.target.value });
    window.localStorage.setItem("USERNAME", event.target.value);
  }

  render() {
    return (
      <div className="segment">
        <form className="ui form" onSubmit={this.onFormSubmit}>
          <div className="field">
            <label>Username</label>
            <input
              value={this.state.username}
              onChange={this.onChange}
              onBlur={this.onFormSubmit}
            />
          </div>
        </form>
      </div>
    );
  }
}

export default SearchBox;
