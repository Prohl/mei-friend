import {
  forkRepository,
  forkRepositoryCancel
} from './fork-repository.js';
import {
  cm,
  fileChanged,
  github, // github instance
  handleEncoding,
  isMEI,
  meiFileName,
  setFileChangedState,
  setGithubInstance, // github instance setter
  setIsMEI,
  setMeiFileInfo,
  storage,
  updateFileStatusDisplay,
  updateGithubInLocalStorage,
  updateLocalStorage,
  v
} from './main.js';
import * as icon from './../css/icons.js';
import Github from './github.js'; // github class
function forkRepo() {
  forkRepository(github);
}

export function forkRepoClicked() {
  // inputRepoOverride is used to supply a repository via the forkAndOpen (?fork parameter) path
  let inputName = document.getElementById('forkRepositoryInputName').value
  let inputRepo = document.getElementById('forkRepositoryInputRepo').value
  let inputRepoOverride = document.getElementById('forkRepositoryInputRepoOverride').value
  let inputBranchOverride = document.getElementById('forkRepositoryInputBranchOverride').value
  let inputFilepathOverride = document.getElementById('forkRepositoryInputFilepathOverride').value
  let forkRepositoryStatus = Array.from(document.getElementsByClassName("forkRepositoryStatus"));
  let forkRepositoryToSelector = document.querySelector("#forkRepositoryToSelector");
  if (inputName && (inputRepo || inputRepoOverride)) {
    inputRepo = inputRepoOverride ? inputRepoOverride : inputRepo;
    let githubRepo = `${inputName}/${inputRepo}`;
    github.githubRepo = githubRepo;
    Array.from(document.getElementsByClassName("forkRepoGithubLogo"))
      .forEach(l => l.classList.add("clockwise"));
    github.fork(() => {
        forkRepositoryStatus.forEach(s => {
          s.classList.remove("warn");
          s.innerHTML = "";
        })
        fillInRepoBranches();
        forkRepositoryCancel();
      }, forkRepositoryToSelector.value)
      .catch((e) => {
        forkRepositoryStatus.forEach(s => {
          s.classList.add("warn");
          s.innerHTML = "Sorry, couldn't fork repository";
          if (typeof e === "object" && "status" in e) {
            s.innerHTML = e.status + " " + e.statusText;
            if (e.status !== 404) {
              e.json().then((err) => {
                if ('message' in err)
                  s.innerHTML += ". Github message: <i>" +
                  err.message + "</i>";
              })
            }
          }
        })
      }).finally(() => {
        if (inputRepoOverride && inputBranchOverride && inputFilepathOverride) {
          // forkAndOpen path: directly switch to specified branch and open file
          github.branch = inputBranchOverride;
          const _filepath = inputFilepathOverride.substring(0, inputFilepathOverride.lastIndexOf("/") + 1)
          const _file = inputFilepathOverride.substring(inputFilepathOverride.lastIndexOf("/") + 1)
          github.filepath = _filepath;
          setMeiFileInfo(github.filepath, github.githubRepo, github.githubRepo + ":");
          loadFile(_file);
          updateFileStatusDisplay();
        } 
        document.getElementById("GithubLogo").classList.remove("clockwise");
        Array.from(document.getElementsByClassName("forkRepoGithubLogo"))
          .forEach(l => l.classList.remove("clockwise"));
        document.getElementById("forkRepositoryInputRepoOverride").value = "";
        document.getElementById("forkRepositoryInputBranchOverride").value = "";
        document.getElementById("forkRepositoryInputFilepathOverride").value = "";
      });
  }
}

function forkRepoCancelClicked() {
  let menuList = document.querySelectorAll(".dropdown-content");
  menuList.forEach((e) => e.classList.remove('show'));
  forkRepositoryCancel();
};

function repoHeaderClicked() {
  github.filepath = "";
  refreshGithubMenu(); // reopen
  let githubMenu = document.getElementById("GithubMenu");
  githubMenu.classList.add("forceShow");
  githubMenu.classList.add("show");
}

function branchesHeaderClicked(ev) {
  github.filepath = "";
  fillInRepoBranches(ev.target);
}

function contentsHeaderClicked(ev) {
  // strip trailing slash (in case our filepath is a subdir)
  if (github.filepath.endsWith("/"))
    github.filepath = github.filepath.substring(0, github.filepath.length - 1);
  //  retreat to previous slash (back one directory level)
  github.filepath = github.filepath.substring(0, github.filepath.lastIndexOf('/') + 1);
  // if we've retreated past the root dir, restore it
  github.filepath = github.filepath.length === 0 ? "/" : github.filepath;
  const githubLoadingIndicator = document.getElementById("GithubLogo");
  githubLoadingIndicator.classList.add("clockwise");
  github.readGithubRepo().then(() => {
    fillInBranchContents(ev)
    githubLoadingIndicator.classList.remove("clockwise");
  }).catch(() => {
    console.warn("Couldn't read Github repo to fill in branch contents");
    githubLoadingIndicator.classList.remove("clockwise");
  });
}

function userRepoClicked(ev) {
  // re-init github object with selected repo
  const author = github.author;
  setGithubInstance(new Github(
    ev.target.innerText,
    github.githubToken,
    github.branch,
    github.commit,
    github.filepath,
    github.userLogin,
    author.name,
    author.email
  ))
  fillInRepoBranches(ev);
}

function repoBranchClicked(ev) {
  const githubLoadingIndicator = document.getElementById("GithubLogo");
  github.branch = ev.target.innerText;
  github.filepath = "/";
  githubLoadingIndicator.classList.add("clockwise");
  github.readGithubRepo().then(() => {
    fillInBranchContents(ev)
    githubLoadingIndicator.classList.remove("clockwise");
  }).catch(() => {
    console.warn("Couldn't read Github repo to fill in branch contents");
    githubLoadingIndicator.classList.remove("clockwise");
  });
}

function branchContentsDirClicked(ev) {
  let target = ev.target;
  if (!target.classList.contains("filepath")) {
    // if user hasn't clicked directly on the filepath <span>, drill down to it
    target = target.querySelector(".filepath")
  }
  if (github.filepath.endsWith("/")) {
    github.filepath += target.innerText + "/";
  } else {
    github.filepath += "/" + target.innerText + "/";
  }
  fillInBranchContents(ev);
}

function branchContentsFileClicked(ev) {
  loadFile(ev.target.innerText);
  document.getElementById("GithubMenu").classList.remove("forceShow");
}

function loadFile(fileName, ev = null) {
  const githubLoadingIndicator = document.getElementById("GithubLogo");
  github.filepath += fileName;
  console.debug(`Loading file: https://github.com/${github.githubRepo}${github.filepath}`);
  fillInBranchContents(ev);
  githubLoadingIndicator.classList.add("clockwise");
  github.readGithubRepo().then(() => {
    githubLoadingIndicator.classList.remove("clockwise");
    cm.readOnly = false;
    document.querySelector(".statusbar").innerText = "Loading from Github...";
    v.clear();
    v.updateNotation = false;
    setMeiFileInfo(
      github.filepath, // meiFileName
      github.githubRepo, // meiFileLocation
      github.githubRepo + ":" // meiFileLocationPrintable
    );
    handleEncoding(github.content);
    setFileNameAfterLoad();
    updateFileStatusDisplay();
    setFileChangedState(false);
    updateGithubInLocalStorage();
    fillInCommitLog("withRefresh");
    const fnStatus = document.getElementById("fileName");
    if (fnStatus) fnStatus.removeAttribute("contenteditable");
  }).catch((err) => {
    console.error("Couldn't read Github repo to fill in branch contents:", err);
    githubLoadingIndicator.classList.remove("clockwise");
  })
}

function onFileNameEdit(e) {
  setCommitUIEnabledStatus();
}

function onMessageInput(e) {
  e.target.classList.remove("warn");
  if (e.target.innerText = "") {
    document.getElementById("commitButton").setAttribute("disabled", "");
  } else {
    document.getElementById("commitButton").removeAttribute("disabled");
  }

}

function assignGithubMenuClickHandlers() {
  // This function is called repeatedly during runtime as the content of the
  // Github menu is dynamic. Therefore, we remove all event listeners below
  // before adding them, to avoid attaching multiple identical listeners.
  const githubMenu = document.getElementById("GithubMenu");
  if(githubMenu) { 
    githubMenu.removeEventListener('mouseleave', (e) => e.target.classList.remove("forceShow"));
    githubMenu.addEventListener('mouseleave', (e) => e.target.classList.remove("forceShow"));
  }

  const githubLoadingIndicator = document.getElementById("GithubLogo");
  const logoutButton = document.getElementById('GithubLogout');
  if (logoutButton) {
    logoutButton.removeEventListener('click', logoutFromGithub);
    logoutButton.addEventListener('click', logoutFromGithub);
  }
  const forkRepositoryElement = document.getElementById('forkRepository');
  if (forkRepositoryElement) {
    forkRepositoryElement.removeEventListener('click', forkRepo);
    forkRepositoryElement.addEventListener('click', forkRepo)
  }

  const forkRepositoryButton = document.getElementById('forkRepositoryButton');
  const forkRepositoryCancelButton = document.getElementById('forkRepositoryCancel');
  if (forkRepositoryButton) {
    forkRepositoryButton.removeEventListener('click', forkRepoClicked)
    forkRepositoryButton.addEventListener('click', forkRepoClicked)
  }

  if (forkRepositoryCancelButton) {
    forkRepositoryCancelButton.removeEventListener('click', forkRepoCancelClicked);
    forkRepositoryCancelButton.addEventListener('click', forkRepoCancelClicked);
  }

  const repoHeader = document.getElementById('repositoriesHeader');
  if (repoHeader) {
    // on click, reload list of all repositories
    repoHeader.removeEventListener('click', repoHeaderClicked);
    repoHeader.addEventListener('click', repoHeaderClicked);
  }
  const branchesHeader = document.getElementById('branchesHeader');
  if (branchesHeader) {
    // on click, reload list of branches for current repo
    branchesHeader.removeEventListener('click', branchesHeaderClicked);
    branchesHeader.addEventListener('click', branchesHeaderClicked);
  }
  const contentsHeader = document.getElementById('contentsHeader');
  if (contentsHeader) {
    // on click, move up one directory level in the branch contents
    contentsHeader.removeEventListener('click', contentsHeaderClicked);
    contentsHeader.addEventListener('click', contentsHeaderClicked);
  }
  Array.from(document.getElementsByClassName('userRepo')).forEach((e) => {
    e.removeEventListener('click', userRepoClicked);
    e.addEventListener('click', userRepoClicked);
  });
  Array.from(document.getElementsByClassName('repoBranch')).forEach((e) => {
    e.removeEventListener('click', repoBranchClicked);
    e.addEventListener('click', repoBranchClicked);
  });
  Array.from(document.getElementsByClassName('branchContents')).forEach((e) => {
    if (e.classList.contains("dir")) {
      // navigate directory
      e.removeEventListener('click', branchContentsDirClicked);
      e.addEventListener('click', branchContentsDirClicked);
    } else {
      // load file
      e.removeEventListener('click', branchContentsFileClicked);
      e.addEventListener('click', branchContentsFileClicked);
    }
  })
}

export async function fillInUserRepos(per_page = 30, page = 1) {
  const repos = await github.getUserRepos(per_page, page);
  if (document.getElementById("branchesHeader")) {
    // if user has navigated away wiew while we 
    // were waiting for the user repos list, abandon it
    return;
  }
  let githubMenu = document.getElementById("GithubMenu");
  repos.forEach((repo) => {
    githubMenu.innerHTML += `<a class="userRepo" href="#">${repo.full_name}</a>`;
  })
  if (repos.length && repos.length === per_page) {
    // there may be more repos on the next page
    fillInUserRepos(per_page, page + 1);
  }
  // GitHub menu interactions
  assignGithubMenuClickHandlers();
}

export async function fillInRepoBranches(e, per_page = 100, page = 1) {
  // TODO handle > per_page branches (similar to userRepos)
  const repoBranches = await github.getRepoBranches(per_page, page);
  let githubMenu = document.getElementById("GithubMenu");
  githubMenu.innerHTML = `
  <a id="GithubLogout" href="#">Log out</a>
  <hr class="dropdown-line">
  <a id="repositoriesHeader" href="#"><span class="btn icon inline-block-tight">${icon.arrowLeft}</span>Repository:${github.githubRepo}</a>
    <hr class="dropdown-line">
    <a id="branchesHeader" class="dropdown-head" href="#"><b>Select branch:</b></a>
    `;
  Array.from(repoBranches).forEach((branch) => {
    githubMenu.innerHTML += `<a class="repoBranch" href="#">${branch.name}</a>`;
  });
  // GitHub menu interactions
  assignGithubMenuClickHandlers();
  v.setMenuColors();
}

async function markFileName(fname) {
  // purpose: assign markers like "~1" before the suffix
  // to differentiate from existing files
  // e.g. "meifile.mei" => "myfile~1.mei"
  if (!fname.endsWith(".mei")) {
    console.warn("markFileName called on non-mei suffix: ", fname);
  }
  const without = fname.substring(0, fname.lastIndexOf("."));
  const match = without.match("(.*)~\\d+$");
  const unmarked = match ? match[1] : without;
  let fnamesInTree;
  const containingDir = github.filepath.substring(0, github.filepath.lastIndexOf("/"));
  return github.getBranchContents(containingDir).then(tree => {
    fnamesInTree = tree.map(contents => contents.name);
    const prevMarked = fnamesInTree.filter(f => f.match(without + "~\\d+.mei$"));
    let marked;
    if (prevMarked.length) {
      // marks already exist in current tree, so use "~n" where n is
      // one bigger than the largest existing mark
      const prevMarkNums = prevMarked.map(f =>
        f.match(without + "~(\\d+).mei$")[1])
      const n = Math.max(...prevMarkNums) + 1;
      marked = `${unmarked}~${n}.mei`;
    } else marked = `${unmarked}~1.mei`;
    return marked;
  });
}

async function proposeFileName(fname) {
  // if we're here, the original file wasn't MEI
  const suffixPos = fname.lastIndexOf(".");
  let suffix = "";
  let without = fname;
  let newname;
  let nameSpan = document.getElementById("commitFileName");
  const containingDir = github.filepath.substring(0, github.filepath.lastIndexOf("/"));
  github.getBranchContents(containingDir).then(dirContents => {
    const fnamesInTree = dirContents.map(c => c.name);
    if (suffixPos > 0) {
      // there's a dot and it's not at the start of the name
      // => treat everything after it as the suffix
      without = fname.substring(0, suffixPos);
      suffix = fname.substring(suffixPos + 1);
    }
    if (suffix.toLowerCase() !== "mei") {
      // see if we can get away with simply swapping suffix
      newname = without + ".mei";
      if (fnamesInTree.includes(newname)) {
        // no we can't - so mark it to differentiate
        markFileName(newname).then(marked => {
          nameSpan.innerText = marked;
          nameSpan.dispatchEvent(new Event('input'));
        })
      } else {
        nameSpan.innerText = newname;
        nameSpan.dispatchEvent(new Event('input'));
      }
    } else {
      // file was already (mis-)named (?) as ".mei"
      // propose adding a marker like "~1" to differentiate
      markFileName(fname).then(marked => {
        nameSpan.innerText = marked;
        nameSpan.dispatchEvent(new Event('input'));
      })
    }
  })
}

export async function fillInBranchContents(e) {
  // TODO handle > per_page files (similar to userRepos)
  let target = document.getElementById("contentsHeader");
  const branchContents = await github.getBranchContents(github.filepath);
  let githubMenu = document.getElementById("GithubMenu");
  githubMenu.innerHTML = `
  <a id="GithubLogout" href="#">Log out</a>
  <hr class="dropdown-line">
  <a id="repositoriesHeader" href="#"><span class="btn icon inline-block-tight">${icon.arrowLeft}</span>Repository:${github.githubRepo}</a>
    <hr class="dropdown-line">
    <a id="branchesHeader" href="#"><span class="btn icon inline-block-tight">${icon.arrowLeft}</span>Branch: ${github.branch}</a>
    <hr class="dropdown-line">
    <a id="contentsHeader" href="#"><span class="btn icon inline-block-tight filepath">${icon.arrowLeft}</span>Path: <span class="filepath">${github.filepath}</span></a>
    <hr class="dropdown-line">
    `;

  if (e) {
    Array.from(branchContents).forEach((content) => {
      const isDir = content.type === "dir";
      githubMenu.innerHTML += `<a class="branchContents ${content.type}${isDir ? '': ' closeOnClick'}" href="#">` +
        //  content.type === "dir" ? '<span class="btn icon icon-file-symlink-file inline-block-tight"></span>' : "" +
        `<span class="filepath${isDir ? '':' closeOnClick'}">${content.name}</span>${isDir ? "..." : ""}</a>`;
    });
  } else {
    // Either User clicked file, or we're on forkAndOpen path, or restoring from local storage. Display commit interface
    if (github.filepath) {
      setMeiFileInfo(
        github.filepath, // meiFileName
        github.githubRepo, // meiFileLocation
        github.githubRepo + ":" // meiFileLocationPrintable
      );
    }
    if (storage.supported) {
      storage.fileLocationType = "github";
    }

    const commitUI = document.createElement("div");
    commitUI.setAttribute("id", "commitUI");

    const commitFileName = document.createElement("span");
    commitFileName.setAttribute("contenteditable", "");
    commitFileName.setAttribute("id", "commitFileName");
    commitFileName.setAttribute("spellcheck", "false");

    const commitFileNameEdit = document.createElement("div");
    commitFileNameEdit.setAttribute("id", "commitFileNameEdit");
    commitFileNameEdit.innerHTML = 'Filename: ';
    commitFileNameEdit.appendChild(commitFileName);

    const commitMessageInput = document.createElement("input");
    commitMessageInput.setAttribute("type", "text");
    commitMessageInput.setAttribute("id", "commitMessageInput");
    commitMessageInput.setAttribute("placeholder", "Updated using mei-friend online");
    const commitButton = document.createElement("input");
    commitButton.setAttribute("id", "commitButton");
    commitButton.setAttribute("type", "submit");
    commitButton.classList.add("closeOnClick");
    commitButton.addEventListener("click", handleCommitButtonClicked);
    commitUI.appendChild(commitFileNameEdit);
    commitUI.appendChild(commitMessageInput);
    commitUI.appendChild(commitButton);
    githubMenu.appendChild(commitUI);
    setFileNameAfterLoad();
    setFileChangedState(fileChanged);
    commitMessageInput.removeEventListener("input", onMessageInput);
    commitMessageInput.addEventListener("input", onMessageInput);
    commitFileName.removeEventListener("input", onFileNameEdit);
    commitFileName.addEventListener("input", onFileNameEdit);
  }
  fillInCommitLog("withRefresh");
  // GitHub menu interactions
  assignGithubMenuClickHandlers();
  v.setMenuColors();
}

async function fillInCommitLog(refresh = false) {
  if (refresh) {
    const githubLoadingIndicator = document.getElementById("GithubLogo");
    githubLoadingIndicator.classList.add("clockwise");
    github.readGithubRepo().then(() => {
      githubLoadingIndicator.classList.remove("clockwise");
      renderCommitLog();
    }).catch((e) => {
      githubLoadingIndicator.classList.remove("clockwise");
      console.warn("Couldn't read github repo", e);
    })
  } else {
    renderCommitLog();
  }
}

export function renderCommitLog() {
  let branchesHeader = document.getElementById("branchesHeader");
  if (!branchesHeader) {
    // if user has navigated away from branch contents view while we 
    // were waiting for the commit log, abandon it.
    return;
  }
  let logTable = document.getElementById("logTable");
  if (logTable) {
    // clear up previous logTable if it exists
    logTable.remove();
    document.getElementById("commitLogSeperator").remove();
  }
  logTable = document.createElement("table");
  logTable.setAttribute("id", "logTable");
  let githubMenu = document.getElementById("GithubMenu");
  const headerRow = document.createElement("tr");
  headerRow.innerHTML =
    "<th>Date</th><th>Author</th><th>Message</th><th>Commit</th>";
  logTable.appendChild(headerRow);
  github.commitLog.forEach((c) => {
    const commitRow = document.createElement("tr");
    commitRow.innerHTML = `
      <td>${c.commit.author.date}</td>
      <td><a href="${c.commit.author.html_url}">${c.commit.author.name}</a></td>
      <td>${c.commit.message}</td>
      <td><a target="_blank" href="https://github.com/${github.githubRepo}/commits/${c.sha}">${c.sha.slice(0,8)}...</a></td>`;
    logTable.appendChild(commitRow);
  })
  const commitLogHeader = document.createElement("a");
  commitLogHeader.setAttribute("id", "commitLogHeader");
  commitLogHeader.innerText = "Commit Log";
  const hr = document.createElement("hr");
  hr.classList.add("dropdown-line");
  hr.setAttribute("id", "commitLogSeperator");
  githubMenu.appendChild(hr);
  githubMenu.appendChild(logTable);
}

export function logoutFromGithub() {
  if (storage.supported) {
    // remove github object from local storage
    storage.removeItem("github");
  }
  // redirect to /logout to remove session cookie
  let url = window.location.href;
  // remove any url parameters (since these might include URLs with slashes in)
  const paramsStartIx = url.indexOf("?");
  if (paramsStartIx > -1)
    url = url.substring(0, paramsStartIx);
  // now modify last slash to navigate to /logout
  window.location.replace(url.substring(0, url.lastIndexOf("/")) + "/logout");
}

export function refreshGithubMenu() {
  // display Github name
  document.getElementById("GithubName").innerText =
    github.author.name === "None" ? github.userLogin : github.author.name;
  // populate Github menu
  let githubMenu = document.getElementById("GithubMenu");
  githubMenu.classList.remove("loggedOut");
  githubMenu.innerHTML = `<a id="GithubLogout" href="#">Log out</a>`
  if (!github.filepath) {
    githubMenu.innerHTML += `
    <hr class="dropdown-line">
    <a id="forkRepository" href="#">Fork repository...</b></a>
    <hr class="dropdown-line">
    <a id="repositoriesHeader" class="dropdown-head" href="#"><b>Select repository:</b></a>`;
    fillInUserRepos();
  }
}

export function setCommitUIEnabledStatus() {
  const commitButton = document.getElementById("commitButton");
  if(commitButton) { 
    const commitFileName = document.getElementById("commitFileName");
    if (commitFileName.innerText === stripMeiFileName()) {
      // no name change => button reads "Commit"
      commitButton.setAttribute("value", "Commit");
      if (fileChanged) {
        // enable commit UI if file has changed
        commitButton.removeAttribute("disabled");
        commitMessageInput.removeAttribute("disabled");
      } else {
        // disable commit UI if file hasn't changed
        commitButton.setAttribute("disabled", "");
        commitMessageInput.setAttribute("disabled", "");
        commitMessageInput.value = "";
      }
    } else {
      // file name has changed => button reads "Commit as new file"
      commitButton.setAttribute("value", "Commit as new file");
      // enable commit UI regardless of fileChanged state
      commitButton.removeAttribute("disabled");
      commitMessageInput.removeAttribute("disabled");
    }
  }
}


function setFileNameAfterLoad(ev) {
  const commitButton = document.getElementById("commitButton");
  if(commitButton) { 
    const commitFileName = document.getElementById("commitFileName");
    if (isMEI) {
      // trim preceding slash
      commitFileName.innerText = stripMeiFileName();
      commitButton.setAttribute("value", "Commit");
    } else {
      commitFileName.innerText = "...";
      commitButton.setAttribute("value", "...");
      // trim preceding slash
      proposeFileName(stripMeiFileName());
    }
    setCommitUIEnabledStatus();
  }
}

// handle Github commit UI
function handleCommitButtonClicked(e) {
  const commitFileName = document.getElementById("commitFileName");
  const messageInput = document.getElementById("commitMessageInput");
  const message = messageInput.value;
  console.log("Got message: ", message);
  if (message) {
    const githubLoadingIndicator = document.getElementById("GithubLogo");
    // lock editor while we are busy commiting
    cm.readOnly = "nocursor"; // don't allow editor focus
    // try commiting to Github
    githubLoadingIndicator.classList.add("clockwise");
    const newfile = commitFileName.innerText !== stripMeiFileName() ?
      commitFileName.innerText : null;
    github.writeGithubRepo(cm.getValue(), message, newfile)
      .then(() => {
        console.debug(`Successfully written to github: ${github.githubRepo}${github.filepath}`);
        messageInput.value = "";
        if (newfile) {
          // switch to new filepath
          github.filepath = github.filepath.substring(0, github.filepath.lastIndexOf('/') + 1) + newfile;
        }
        // load after write
        loadFile("");
      })
      .catch((e) => {
        cm.readOnly = false;
        githubLoadingIndicator.classList.remove("clockwise");
        console.warn("Couldn't commit Github repo: ", e, github)
      });
  } else {
    // no commit without a comit message!
    messageInput.classList.add("warn");
    document.getElementById("commitButton").setAttribute("disabled", "");
    e.stopPropagation(); // prevent bubbling to stop github menu closing
  }
}

function stripMeiFileName() {
  const stripped = meiFileName.match(/^.*\/([^\/]+)$/);
  if (Array.isArray(stripped)) {
    return stripped[1];
  } else {
    console.warn("stripMeiFileName called on invalid filename: ", meiFileName);
  }
}