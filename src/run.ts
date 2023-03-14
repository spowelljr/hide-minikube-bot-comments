import * as core from '@actions/core'
import * as github from '@actions/github'
import { CommentsQuery } from './generated/graphql'
import { queryComments } from './queries/comments'
import { minimizeComment } from './queries/minimize'

export const run = async (): Promise<void> => {
  if (github.context.payload.issue === undefined) {
    core.info(`non issue event: ${github.context.eventName}`)
    return
  }
  const pullNumber = github.context.payload.issue.number
  const octokit = github.getOctokit(core.getInput('token', { required: true }))

  const q = await core.group(`query comments in pull request #${pullNumber}`, async () => {
    const q = await queryComments(octokit, {
      owner: github.context.repo.owner,
      name: github.context.repo.repo,
      number: pullNumber,
    })
    core.info(JSON.stringify(q, undefined, 2))
    return q
  })

  const filteredComments = filterComments(q)
  for (const c of filteredComments) {
    core.info(`minimize comment ${c.url}`)
    await minimizeComment(octokit, { id: c.id })
  }
}

type Comment = NonNullable<
  NonNullable<
    NonNullable<NonNullable<NonNullable<CommentsQuery['repository']>['pullRequest']>['comments']>['nodes']
  >[number]
>

const filterComments = (q: CommentsQuery): Comment[] => {
  if (q.repository?.pullRequest?.comments.nodes == null) {
    core.info(`unexpected response: repository === ${JSON.stringify(q.repository)}`)
    return []
  }
  const comments = []
  for (const node of q.repository.pullRequest.comments.nodes) {
    if (node == null) {
      continue
    }
    comments.push(node)
  }
  return comments.filter((c) => toMinimize(c))
}

let isNewestPerformance = true
let isNewestFlake = true

export const toMinimize = (c: Comment): boolean => {
  if (c.isMinimized) {
    return false
  }
  if (c.author?.login !== 'minikube-pr-bot') {
    return false
  }
  if (c.body.includes('kvm2 driver with docker runtime')) {
    if (isNewestPerformance) {
      core.info(`latest performance comment, skipping: ${c.url}`)
      isNewestPerformance = false
      return false
    }
    core.info(`performance comment: ${c.url}`)
    return true
  }
  if (c.body.includes('These are the flake rates of all failed tests.')) {
    if (isNewestFlake) {
      core.info(`latest flake rate comment, skipping: ${c.url}`)
      isNewestFlake = false
      return false
    }
    core.info(`flake rate comment: ${c.url}`)
    return true
  }
  return false
}
