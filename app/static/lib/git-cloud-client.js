import { get } from "http";

export default class GitCloudClient {
  constructor(conf) {
    console.log('GitCloudClient constructor', conf);
    this.token = conf.token;
    this.provider = conf.provider; // e.g. 'github'
    this.providerType = conf.providerType; // e.g. 'github'
    if (!(this.token && this.provider && this.providerType)) {
      throw new Error('Missing required configuration');
    }
    // Provider-specific configuration
    switch (this.providerType) {
      case 'github':
        this.apiHeaders = {
          Authorization: `token ${conf.token}`,
          Accept: 'application/vnd.github.v3+json',
        };
        this.orgsUrl = `https://api.github.com/user/memberships/orgs`;
        this.reposUrl = `https://api.github.com/user/repos`;
        break;
      case 'gitlab':
        this.apiHeaders = {
          Authorization: `Bearer ${conf.token}`,
          Accept: 'application/json',
        };
        this.orgsUrl = `https://gitlab.com/api/v4/groups`;
        this.reposUrl = `https://gitlab.com/api/v4/projects`;
        break;
      case 'bitbucket':
        this.apiHeaders = {
          Authorization: `Bearer ${conf.token}`,
          Accept: 'application/json',
        };
        this.orgsUrl = `https://api.bitbucket.org/2.0/teams`;
        this.reposUrl = `https://api.bitbucket.org/2.0/repositories`;
        break;
      case 'codeberg':
        this.apiHeaders = {
          Authorization: `Bearer ${conf.token}`,
          Accept: 'application/json',
        };
        this.orgsUrl = `https://codeberg.org/api/v1/user/orgs`;
        this.reposUrl = `https://codeberg.org/api/v1/user/repos`;
        break;
      default:
        throw new Error('Unknown provider');
    }
    this.author = getAuthor(this.providerType);
  }

  async getOrgs() {
    return fetch(this.orgsUrl, {
      method: 'GET',
      headers: this.apiHeaders,
    }).then((res) => res.json());
    // fetch all organizations the user belongs to from the cloud provider
    console.log('getOrganizations');
  }

  async getRepos(per_page = 30, page = 1) {
    const reposUrl = `https://api.github.com/user/repos?per_page=${per_page}&page=${page}`;
    return fetch(reposUrl, {
      method: 'GET',
      headers: this.apiHeaders,
    }).then((res) => res.json());
  }

  async getBranches(repo) {
    // fetch all branches of the current repository from the cloud provider
    console.log('getBranches');
  }

  async getCommits(repo, branch) {
    // fetch all commits of the current repository and branch from the cloud provider
    console.log('getCommits');
  }

  async getFiles(repo, branch) {
    // fetch all files of the current repository and branch from the cloud provider
    console.log('getFiles');
  }

  async getContents(repo, branch, path) {
    // fetch the content of a file from the cloud provider
    console.log('getContents');
  }

  async getAuthor(providerType) {
    // obtain the logged in user's name and email from the cloud provider, using appropriate API
    // if no name or email specified, use the user's login name and empty email
    let author = { name: '', email: '' };
    let user;
    switch (providerType) {
      case 'github':
        // fetch the user's name and email from the GitHub API
        user = await fetch('https://api.github.com/user', {
          method: 'GET',
          headers: this.apiHeaders,
        }).then((res) => res.json());
        break;
      case 'gitlab':
        // fetch the user's name and email from the GitLab API
        user = await fetch('https://gitlab.com/api/v4/user', {
          method: 'GET',
          headers: this.apiHeaders,
        }).then((res) => res.json());
        break;
      case 'bitbucket':
        // fetch the user's name and email from the Bitbucket API
        user = await fetch('https://api.bitbucket.org/2.0/user', {
          method: 'GET',
          headers: this.apiHeaders,
        }).then((res) => res.json());
        break;
      case 'codeberg':
        // fetch the user's name and email from the Codeberg API
        const user = await fetch('https://codeberg.org/api/v1/user', {
          method: 'GET',
          headers: this.apiHeaders,
        }).then((res) => res.json());
        break;
      default:
        throw new Error('Unknown provider');
    }
    author.name = user.full_name || user.username;
    author.email = user.email || '';
    return author;
  }
}
