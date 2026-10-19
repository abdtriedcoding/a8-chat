# Shared snapshots copy the thread

Sharing a thread copies its finished turns into a shared snapshot that its public link shows, instead of showing the live thread. With a copy, the user knows exactly what the link exposes: a prompt sent after sharing, which might hold private data, doesn't reach anyone holding the link until the user shares again. Sharing again updates the same snapshot, so a thread has one link to revoke.

## Considered options

- **Show the live thread:** no copy to store and the link is always current, but every later prompt, attachment and reply goes public without the user deciding to share it.
- **A new snapshot per share:** each link keeps what it showed, but the user ends up with several links per thread to track and revoke.

## Consequences

- The snapshot stores its own copy of the turns, so editing, regenerating or stopping a reply in the thread after sharing doesn't change what the link shows.
- Attachments in a snapshot must outlive cleanup of the thread's files for as long as the snapshot exists. Deleting the thread deletes its snapshot.
