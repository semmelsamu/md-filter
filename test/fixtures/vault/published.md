---
publish: true
title: Hello
date: 2024-01-01
status: done
cover: "cover.jpg"
another-attachment: here.jpg
also-this: "[[wiki-fm.jpg]]"
gallery:
  - nested/deep.png
---

# Published

![inline](images/inline.png)
[The spec](docs/spec%20v1.pdf "Specification")
![[embed.png|300]]
[[doc.pdf#page=2]]

Links to notes are not attachments: [[draft]], [[Future note]], [other](notes/nested.md).
External links are ignored: [site](https://example.com), [mail](mailto:a@b.c).

Code is ignored: `![](code.png)`

```md
![[fenced.png]]
```

![[missing.png]]
