import React from "react";

class SearchBox extends React.Component {
  state = { username: "vinillum" };

  onFormSubmit = (event) => {
    event.preventDefault();
    this.props.onSubmit(this.state.username);
  };

  render() {
    return (
      <div className="segment">
        <form className="ui form" onSubmit={this.onFormSubmit}>
          <div className="field">
            <label>Username</label>
            <input
              value={this.username}
              onChange={(e) => this.setState({ username: e.target.value })}
            />
          </div>
        </form>
      </div>
    );
  }
}

export default SearchBox;
