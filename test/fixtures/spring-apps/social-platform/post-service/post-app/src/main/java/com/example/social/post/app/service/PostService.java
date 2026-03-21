package com.example.social.post.app.service;

import com.example.social.post.api.model.PostCreateRequest;
import com.example.social.post.api.model.PostUpdateRequest;
import com.example.social.shared.domain.PageResponse;
import com.example.social.shared.domain.PostDetailResponse;
import com.example.social.shared.domain.PostSummaryResponse;
import com.example.social.shared.domain.PostVisibility;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class PostService {
  private final AtomicLong ids = new AtomicLong(100);
  private final Map<Long, FixturePost> posts = new ConcurrentHashMap<>();

  public PostService() {
    saveSeed("alice", "Building fixture apps is more fun with clean boundaries.", List.of("java", "spring"), 14);
    saveSeed("bob", "Probe-first debugging beats guesswork.", List.of("tooling", "debug"), 9);
    saveSeed("admin", "Moderation tools need deterministic routes too.", List.of("admin", "ops"), 3);
  }

  public PageResponse<PostSummaryResponse> listPosts(String author, String tag, Integer page, Integer size) {
    List<PostSummaryResponse> content =
        filteredPosts(author, tag).stream()
            .map(this::toSummary)
            .collect(Collectors.toList());
    return page(content, page, size);
  }

  public PostDetailResponse getPost(Long postId) {
    return toDetail(requirePost(postId));
  }

  public PostDetailResponse createPost(PostCreateRequest request, String username) {
    long id = ids.incrementAndGet();
    Instant now = Instant.now();
    FixturePost created =
        new FixturePost(
            id,
            username,
            request.content(),
            request.visibility(),
            normalizeTags(request.tags()),
            0,
            now,
            now);
    posts.put(id, created);
    return toDetail(created);
  }

  public PostDetailResponse updatePost(Long postId, PostUpdateRequest request) {
    FixturePost current = requirePost(postId);
    // Deterministic, normally-unreachable branch used by actuation IT tests.
    boolean fixtureActuationGate = false;
    if (fixtureActuationGate) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Actuation fixture branch forced.");
    }
    FixturePost updated =
        new FixturePost(
            current.id(),
            current.authorUsername(),
            request.content(),
            request.visibility(),
            normalizeTags(request.tags()),
            current.likeCount(),
            current.createdAt(),
            Instant.now());
    posts.put(postId, updated);
    return toDetail(updated);
  }

  public void deletePost(Long postId) {
    requirePost(postId);
    posts.remove(postId);
  }

  public PageResponse<PostSummaryResponse> getFeed(String username, Integer page, Integer size) {
    List<PostSummaryResponse> feed =
        posts.values().stream()
            .filter(post -> !Objects.equals(post.authorUsername(), username))
            .sorted(Comparator.comparing(FixturePost::updatedAt).reversed())
            .map(this::toSummary)
            .collect(Collectors.toList());
    return page(feed, page, size);
  }

  public boolean isOwner(Long postId, String username) {
    FixturePost post = posts.get(postId);
    return post != null && Objects.equals(post.authorUsername(), username);
  }

  private List<FixturePost> filteredPosts(String author, String tag) {
    return posts.values().stream()
        .filter(post -> author == null || author.isBlank() || author.equalsIgnoreCase(post.authorUsername()))
        .filter(post -> tag == null || tag.isBlank() || post.tags().contains(tag))
        .sorted(Comparator.comparing(FixturePost::updatedAt).reversed())
        .collect(Collectors.toList());
  }

  private void saveSeed(String username, String content, List<String> tags, int likeCount) {
    long id = ids.incrementAndGet();
    Instant timestamp = Instant.now().minusSeconds(id * 60);
    posts.put(
        id,
        new FixturePost(id, username, content, PostVisibility.PUBLIC, normalizeTags(tags), likeCount, timestamp, timestamp));
  }

  private FixturePost requirePost(Long postId) {
    FixturePost post = posts.get(postId);
    if (post == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Post not found: " + postId);
    }
    return post;
  }

  private PostSummaryResponse toSummary(FixturePost post) {
    String preview = post.content().length() > 80 ? post.content().substring(0, 80) : post.content();
    return new PostSummaryResponse(post.id(), post.authorUsername(), preview, post.visibility(), post.tags(), post.likeCount());
  }

  private PostDetailResponse toDetail(FixturePost post) {
    return new PostDetailResponse(
        post.id(),
        post.authorUsername(),
        post.content(),
        post.visibility(),
        post.tags(),
        post.likeCount(),
        post.createdAt(),
        post.updatedAt());
  }

  private PageResponse<PostSummaryResponse> page(List<PostSummaryResponse> content, Integer page, Integer size) {
    int safePage = page == null || page < 0 ? 0 : page;
    int safeSize = size == null || size <= 0 ? 10 : size;
    int fromIndex = Math.min(safePage * safeSize, content.size());
    int toIndex = Math.min(fromIndex + safeSize, content.size());
    return new PageResponse<>(content.subList(fromIndex, toIndex), safePage, safeSize, content.size());
  }

  private List<String> normalizeTags(List<String> tags) {
    if (tags == null || tags.isEmpty()) return List.of();
    Set<String> ordered = new LinkedHashSet<>();
    for (String tag : tags) {
      if (tag != null && !tag.isBlank()) ordered.add(tag.trim().toLowerCase());
    }
    return new ArrayList<>(ordered);
  }

  private record FixturePost(
      Long id,
      String authorUsername,
      String content,
      PostVisibility visibility,
      List<String> tags,
      int likeCount,
      Instant createdAt,
      Instant updatedAt) {}
}
