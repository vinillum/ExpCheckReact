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

  onFormSubmit = (event) => {
    event.preventDefault();
    this.props.onSubmit(this.state.token);
  };

  onChange = (event) => {
    this.setState({ token: event.target.value });
    window.localStorage.setItem("API_TOKEN", event.target.value);
  };

  render() {
    return (
      <div className="segment">
        <form className="ui form" onSubmit={this.onFormSubmit}>
          <div className="field">
            <label>API Token</label>
            <input
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
