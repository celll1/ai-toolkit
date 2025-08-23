import json
import os
import re
from typing import Dict, List, Set, Tuple
from pathlib import Path

# Person count tag patterns
PERSON_COUNT_TAG_PATTERNS = [
    re.compile(r"^\d+girls?$"),
    re.compile(r"^\d+boys?$"),
    re.compile(r"^\d+others?$"),
    re.compile(r"^no_humans$"),
    re.compile(r"^multiple_girls$"),
    re.compile(r"^multiple_boys$"),
    re.compile(r"^multiple_others$"),
    re.compile(r"^group$"),  # group tag is also person-related
    re.compile(r"^solo$"),   # solo is also person-related
    re.compile(r"^.*_focus$"),  # any *_focus tag (solo_focus, male_focus, etc.)
    re.compile(r"^still_life$")  # still_life is also person-related
]

class TagGroupManager:
    def __init__(self, tag_group_dir: str = 'taggroup'):
        self.tag_group_dir = tag_group_dir
        self.tag_groups: Dict[str, Set[str]] = {}
        self.tag_to_group: Dict[str, str] = {}
        self.load_tag_groups()
    
    def load_tag_groups(self):
        """Load all tag group JSON files from the specified directory"""
        base_path = Path(self.tag_group_dir)
        if not base_path.exists():
            return
        
        for json_file in base_path.glob('*.json'):
            group_name = json_file.stem
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # Store tags as a set for faster lookup
                    self.tag_groups[group_name] = set(data.keys())
                    # Map each tag to its group
                    for tag in data.keys():
                        self.tag_to_group[tag] = group_name
            except Exception as e:
                print(f"Warning: Failed to load tag group {json_file}: {e}")
    
    def get_tag_group(self, tag: str) -> str:
        """Get the group name for a given tag, returns 'General' if not found in any group"""
        # Strip whitespace for matching
        tag = tag.strip()
        # If tag is found in our mapping, return its group
        if tag in self.tag_to_group:
            return self.tag_to_group[tag]
        # Default to 'General' for unmatched tags
        return 'General'
    
    def is_person_count_tag(self, tag: str) -> bool:
        """Check if a tag is a person count related tag"""
        tag = tag.strip()
        for pattern in PERSON_COUNT_TAG_PATTERNS:
            if pattern.match(tag):
                return True
        return False
    
    def classify_tokens(self, tokens: List[str]) -> Dict[str, List[Tuple[int, str]]]:
        """
        Classify tokens by their group and return a dictionary with group names as keys
        and lists of (original_index, token) tuples as values
        """
        classified = {}
        for idx, token in enumerate(tokens):
            token = token.strip()
            if token:  # Skip empty tokens
                group = self.get_tag_group(token)
                if group not in classified:
                    classified[group] = []
                classified[group].append((idx, token))
        return classified
    
    def shuffle_by_groups(self, tokens: List[str], groups_to_shuffle: List[str], 
                         keep_first_n: int = 0, exclude_person_count: bool = False,
                         shuffle_together: bool = False, rng=None) -> List[str]:
        """
        Shuffle only tokens belonging to specified groups while keeping others in place.
        Can be combined with keep_first_n to also keep the first n tokens fixed.
        
        Args:
            tokens: List of tokens to process
            groups_to_shuffle: List of group names to shuffle (e.g., ['Character', 'General'])
            keep_first_n: Number of first tokens to keep in place (works with group shuffle)
            exclude_person_count: If True, exclude person count tags from shuffling (General group only)
            shuffle_together: If True, shuffle all selected groups together; if False, shuffle within each group
            rng: Random number generator to use for shuffling
        
        Returns:
            List of tokens with specified groups shuffled
        """
        import random
        if rng is None:
            rng = random.Random()
        
        # If no groups specified, return original tokens
        if not groups_to_shuffle:
            return tokens
        
        # Create a copy to work with
        result = tokens.copy()
        
        # Classify tokens by group, but exclude the first n if specified
        start_idx = keep_first_n if keep_first_n > 0 else 0
        tokens_to_classify = tokens[start_idx:]
        
        # Build index mapping for tokens that can be shuffled
        classified = {}
        all_shuffleable_tokens = []  # For shuffle_together mode
        
        for idx, token in enumerate(tokens_to_classify):
            actual_idx = idx + start_idx  # Adjust for keep_first_n offset
            token = token.strip()
            if token:
                group = self.get_tag_group(token)
                if group in groups_to_shuffle:
                    # Check if we should exclude person count tags
                    if exclude_person_count and group == 'General' and self.is_person_count_tag(token):
                        continue  # Skip this token from shuffling
                    
                    if group not in classified:
                        classified[group] = []
                    classified[group].append((actual_idx, token))
                    all_shuffleable_tokens.append((actual_idx, token))
        
        if shuffle_together:
            # Shuffle all selected groups together
            if len(all_shuffleable_tokens) > 1:
                # Extract indices and tokens
                original_indices = [idx for idx, _ in all_shuffleable_tokens]
                tokens_to_shuffle = [token for _, token in all_shuffleable_tokens]
                
                # Shuffle the tokens
                shuffled_tokens = tokens_to_shuffle.copy()
                rng.shuffle(shuffled_tokens)
                
                # Put shuffled tokens back in their positions
                for orig_idx, shuffled_token in zip(original_indices, shuffled_tokens):
                    result[orig_idx] = shuffled_token
        else:
            # Shuffle within each group separately
            for group in groups_to_shuffle:
                if group in classified:
                    group_indices_tokens = classified[group]
                    if len(group_indices_tokens) > 1:
                        # Extract just the tokens for shuffling
                        original_indices = [idx for idx, _ in group_indices_tokens]
                        tokens_to_shuffle = [token for _, token in group_indices_tokens]
                        
                        # Shuffle the tokens
                        shuffled_tokens = tokens_to_shuffle.copy()
                        rng.shuffle(shuffled_tokens)
                        
                        # Put shuffled tokens back in their group's positions
                        for orig_idx, shuffled_token in zip(original_indices, shuffled_tokens):
                            result[orig_idx] = shuffled_token
        
        return result