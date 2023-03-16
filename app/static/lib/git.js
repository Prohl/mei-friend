export default class Git { 
  constructor(gitRepo, gitToken, branch, commit, filepath, userLogin, authorName, authorEmail) {
    this.gitToken = gitToken;
    this.gitRepo = gitRepo;
    this.branch = branch;
    this.commit = commit;
    this.filepath = filepath;
    this.userLogin = userLogin;
    this.author = { 
      name: authorName,
      email: authorEmail
    };
    this.apiHeaders = new Headers({
      'Authorization': 'Basic ' + btoa(userLogin + ":" + gitToken), 
      'Accept': 'application/vnd.github.v3+json'
    });
    // remember this as our 'upstream' repo in case we need to fork
    this.upstreamRepoName = this.gitRepoName;
    this.upstreamRepoOwner = this.gitRepoOwner;
  }

  set content(content) {
    this._content = content;
  }

  get content() { 
    return this._content;
  }

  set updatesBase(updatesBase) {
    this._updatesBase = updatesBase;
  }

  get updatesBase() { 
    return this._updatesBase;
  }

  set commit(commit) { 
    this._commit = commit;
  }

  get commit() { 
    return this._commit;
  }

  set tree(tree) { 
    this._tree = tree;
  }

  get tree() { 
    return this._tree;
  }

  set commitLog(commitLog) { 
    this._commitLog = commitLog;
  }

  get commitLog() { 
    return this._commitLog;
  }
  
  set repo(repo) { 
    this._repo = repo;
  }

  get repo() {
    // no setter...
    return this._repo;
  }

  set userLogin(userLogin) { 
    this._userLogin = userLogin;
  } 
  
  get userLogin() { 
    return this._userLogin;
  }

  set gitRepo(gitRepo) {
    this._githubRepo = gitRepo;
    // also set repo owner and repo name
    [this._gitRepoOwner, this._gitRepoName] = gitRepo.split('/');
    // initialise jsgit repo object
    const repo = {};
    jsgit.mixins.github(repo, this.gitRepo, this.gitToken);
    jsgit.mixins.createTree(repo);
    jsgit.mixins.packOps(repo);
    jsgit.mixins.walkers(repo);
    jsgit.mixins.readCombiner(repo);
    jsgit.mixins.formats(repo);
    jsgit.promisify(repo);
    this.repo = repo;
  }

  get gitRepo() {
    return this._githubRepo;
  }

  set gitRepoName(gitRepoName) {
    // not allowed: needs to be set via githubRepo
    console.warn("gitRepoName cannot be set directly - please set githubRepo or gitlabRepo");
  }

  get gitRepoName() {
    return this._gitRepoName;
  }

  set gitRepoOwner(gitRepoOwner) { 
    // not allowed: needs to be set via githubRepo
    console.warn("gitRepoOwner cannot be set directly - please set githubRepo or gitlabRepo");
  }

  get gitRepoOwner() { 
    return this._gitRepoOwner;
  }

  set gitToken(gitToken) { 
    this._gitToken = gitToken;
  }

  get gitToken(){
    return this._gitToken;
  }
  
  set upstreamRepoName(upstreamRepoName) { 
    this._upstreamRepoName = upstreamRepoName;
  }

  get upstreamRepoName() { 
    return this._upstreamRepoName;
  }

  set upstreamRepoOwner(upstreamRepoOwner) { 
    this._upstreamRepoOwner = upstreamRepoOwner;
  }

  get upstreamRepoOwner() { 
    return this._upstreamRepoOwner;
  }

  set filepath(filepath) { 
    this._filepath = filepath;
  }

  get filepath() { 
    return this._filepath;
  }

  set branch(branch) { 
    this._branch = branch;
  }

  get branch() { 
    return this._branch;
  }

  set author(author) { 
    this._author = author;
  }

  get author() { 
    return this._author;
  }

  set entry(entry) { 
    this._entry = entry;
  }

  get entry() { 
    return this._entry;
  }

  set commitLog(commitLog) { 
    this._commitLog = commitLog;
  }

  get commitLog() { 
    return this._commitLog;
  }

  set isFork(isFork) { 
    console.warn("The isFork flag is set automatically; please do not attempt to set it manually")
  }

  get isFork() { 
    return this.gitRepoOwner !== this.upstreamRepoOwner;
  }


  // Recursively dive into tree until we find the file we're updating.
  // Update the file, then construct hashes all the way back up
  async generateModifiedTreeHash(tree, filepath, content, newfile) { 
    // split into path components and discard leading empty string using filter
    // (in case filepath starts with slash)
    let pathComponents = filepath.split("/").filter(p => p);
    if(pathComponents.length === 1) { 
      // Basecase: we've arrived at the subdir containing our file...
      let entry = tree[pathComponents[0]];
      // replace with new content and get new hash
      let entryHash = await this.repo.saveAs("text", content);
      if(newfile) { 
        // user has requested creation of a new file based off current entry
        // so clone it with the new name
        tree[newfile] = { 
          mode: entry.mode,
          hash: entryHash
        }
      } else { 
        // modify tree with updated entry
        tree[pathComponents[0]] = { 
          mode: entry.mode,
          hash: entryHash
        }
      }
      // calculate and return treeHash for the modified tree:
      return await this.repo.saveAs("tree", tree);
    } else if(pathComponents.length > 1) { 
      // we still have some traversing to do
      // load the next subtree along our filepath:
      let subtree = await this.repo.loadAs("tree", 
        tree[pathComponents[0]].hash);
      // and recurse on it to get a modified (sub)treeHash 
      let subtreeHash = await this.generateModifiedTreeHash(
          subtree,
          pathComponents.splice(1,pathComponents.length).join("/"),
          content,
          newfile
        )
      // modify this tree with new subtreeHash
      tree[pathComponents[0]] = {
        mode: tree[pathComponents[0]].mode, // retain old entry's permissions
        hash: subtreeHash      
      }
      // and return modified tree's treeHash
      return await this.repo.saveAs("tree", tree);
    } else { 
      console.error("Problem figuring out pathComponents for:", filepath);
    }
  }

  async writeGitRepo(content, message, newfile = null) { 
    this.headHash = await this.repo.readRef(`refs/heads/${this.branch}`);
    this.commit = await this.repo.loadAs("commit", this.headHash);  
    let tree = await this.repo.loadAs("tree", this.commit.tree);
    let treeHash = await this.generateModifiedTreeHash(tree, this.filepath, content, newfile);
    let commitHash = await this.repo.saveAs("commit", { 
      tree: treeHash,
      author: this.author,
      parent: this.headHash,
      message: message
    });
    await this.repo.updateRef(`refs/heads/${this.branch}`, commitHash);
    console.debug("Commit complete: ", commitHash)
    // update headHash to new commit's
    this.headHash = await this.repo.readRef(`refs/heads/${this.branch}`);
  }

  async loadGitFileContent(hash) { 
    if(this.filepath.endsWith(".mxl")) { 
      // file suffix suggests compressed musicxml => binary blob
      let blob = await this.repo.loadAs("blob", hash);
      this.content = blob.buffer; // convert from Uint8array to arraybuffer
    } else { 
      this.content = await this.repo.loadAs("text", hash);
    }
  }

  async readGitRepo() { 
    try { 
      // Retrieve content of file
      this.headHash = await this.repo.readRef(`refs/heads/${this.branch}`);
      this.commit = await this.repo.loadAs("commit", this.headHash);  
      let tree = await this.repo.loadAs("tree", this.commit.tree);
      this.entry = tree[this.filepath.startsWith("/") ? this.filepath.substring(1) : this.filepath];
      let treeStream = await this.repo.treeWalk(this.commit.tree);
      let obj;
      let trees = []
      while (obj = await treeStream.read(), obj !== undefined) {
        trees.push(obj)
      }
      const treesFiltered = trees.filter(o => o.path === this.filepath)
      if(treesFiltered.length === 1) { 
        await this.loadGitFileContent(treesFiltered[0].hash);
      } else { 
        if(this.filepath && this.filepath !== "/") {
          // remove leading slash
          await this.loadGitFileContent(this.entry.hash)
          this.tree = tree;
        }
      }
      // Retrieve git commit log
      const commitsUrl = `https://api.github.com/repos/${this.gitRepo}/commits`;
      await fetch(commitsUrl, {
        method: 'GET',
        headers: this.apiHeaders
      }).then(res => res.json())
        .then(async(commits) => { 
          this.commitLog = commits;
        });
    } catch(e) {
      console.error("Error while reading Github repo: ", e, this);
      throw e;
    }
  }

  async getOrganizations() { 
    // return JSON object describing user's memberships in 
    // organizations we have access to
    const orgsUrl = `https://api.github.com/user/memberships/orgs`;
    return fetch(orgsUrl, { 
      method: 'GET',
      headers: this.apiHeaders
    }).then(res => res.json());
    // TODO inspect the organizations list and return those 
    // that give the user writing permission
    /*
      .then((orgs) => orgs.map((o) => {
          console.log("fethcing: ", o.url)
          return fetch(o.url,
           {
              method: 'GET',
              headers: this.apiHeaders
           }
          ).then(o => o.json())
          .then((data) => console.log("Got DATA: ", data, "for ", o.url))
        })
      )
    */
  }

  async fork(callback, forkTo = this.userLogin) {
    // switch to a user's fork, creating it first if necessary
    const forksUrl = `https://api.github.com/repos/${this.gitRepo}/forks`;
    await fetch(forksUrl, {
      method: 'GET',
      headers: this.apiHeaders
    })
      .then(res => {
        if (res.status <= 400) return res.json()
        else throw res
      })
      .then(async(data) => {
        const userFork = data.filter(f => f.owner.login === forkTo)[0];
        // If we don't yet have a user fork, create one
        if(!userFork) {
          // create new fork for user
          let fetchRequestObject = {
            method:'POST',
            headers: this.apiHeaders
          }
          if(forkTo !== this.userLogin) {
            // if we are forking to an organization rather than
            // the user's personal repositories, we have to add
            // a note to say so to the request body
            fetchRequestObject.body = JSON.stringify({
              organization: forkTo
            })
          }
          await fetch(forksUrl, fetchRequestObject)
            .then(res => { 
              if(res.status <= 400) {
                res.json().then(userFork => { 
                  // switch to newly created fork
                  this.gitRepo = userFork.full_name; 
                })
              }
              else throw res;
            })
        } else { 
          this.gitRepo = userFork.full_name;
        }
        // initialise page with user's fork
        callback(this);
      }).catch(err => {
        console.warn("Couldn't retrieve forks from ", forksUrl, ": ", err);
        return Promise.reject(err);
      });
  }

  async pullRequest(callback) { 
    // TODO allow PR to be done against a different branch in upstream repo
    const pullsUrl = `https://api.github.com/repos/${this.upstreamRepoOwner}/${this.upstreamRepoName}/pulls`
    if(this.isFork) { 
      await fetch(pullsUrl, { 
        method: 'POST',
        headers: this.apiHeaders,
        body: JSON.stringify({
          head: this.gitRepoOwner + ":" + this.branch,
          base: this.branch,
          body: 'Programmatic Pull-Request created using prositCommit',
          title: 'Programmatic Pull-Request created using prositCommit'
        })
      }).then(res => res.json())
        .then(async(data) => callback(this, data));
    } else { 
      console.warn("Attempted to create pull-request but repo is not a fork");
    }
  }

  async getSpecifiedUserOrgRepos(userOrg, per_page=30, page=1) { 
    const reposUrl = `https://api.github.com/users/${userOrg}/repos?per_page=${per_page}&page=${page}`;
    return fetch(reposUrl, {
      method: 'GET',
      headers: this.apiHeaders
    }).then(res => res.json())
  }

  async getUserRepos(per_page=30, page=1) { 
    const reposUrl = `https://api.github.com/user/repos?per_page=${per_page}&page=${page}`;
    return fetch(reposUrl, {
      method: 'GET',
      headers: this.apiHeaders
    }).then(res => res.json())
  }

  async getRepoBranches(per_page=30, page=1) {
    const branchesUrl = `https://api.github.com/repos/${this.gitRepo}/branches?per_page=${per_page}&page=${page}`;
    return fetch(branchesUrl, {
      method: 'GET',
      headers: this.apiHeaders
    }).then(res => res.json())
  }
  
  async getBranchContents(path="/") {
    const contentsUrl = `https://api.github.com/repos/${this.gitRepo}/contents${path}`;
    return fetch(contentsUrl, {
      method: 'GET',
      headers: this.apiHeaders
    }).then(res => res.json())
  }
}

