import json
import os
from typing import List, Dict, Any, Union

def evaluate_json_filter(json_data: Dict[str, Any], filter_config: Dict[str, Any]) -> bool:
    """
    Evaluate a single JSON filter against JSON data.
    
    Args:
        json_data: The JSON data to evaluate
        filter_config: Filter configuration with field, type, operator, value
        
    Returns:
        True if the filter passes, False otherwise
    """
    if not filter_config.get('enabled', False):
        return True  # Disabled filters always pass
    
    field = filter_config.get('field', '')
    operator = filter_config.get('operator', '>=')
    expected_value = filter_config.get('value')
    filter_type = filter_config.get('type', 'number')
    
    if not field or expected_value is None:
        return True  # Invalid filter configuration, pass by default
    
    # Get value from JSON data (supports nested fields with dot notation)
    actual_value = get_nested_value(json_data, field)
    
    if actual_value is None:
        return False  # Field not found in JSON
    
    try:
        if filter_type == 'number':
            actual_value = float(actual_value)
            expected_value = float(expected_value)
            
            if operator == '>=':
                return actual_value >= expected_value
            elif operator == '<=':
                return actual_value <= expected_value
            elif operator == '>':
                return actual_value > expected_value
            elif operator == '<':
                return actual_value < expected_value
            elif operator == '==':
                return actual_value == expected_value
            elif operator == '!=':
                return actual_value != expected_value
                
        elif filter_type == 'boolean':
            actual_value = bool(actual_value)
            expected_value = bool(expected_value)
            
            if operator == '==':
                return actual_value == expected_value
            elif operator == '!=':
                return actual_value != expected_value
                
    except (ValueError, TypeError):
        return False  # Type conversion failed
    
    return False  # Unknown operator or type

def get_nested_value(data: Dict[str, Any], field: str) -> Any:
    """
    Get value from nested dictionary using dot notation.
    
    Args:
        data: Dictionary to search in
        field: Field name, supports dot notation (e.g., "metrics.likes")
        
    Returns:
        The value if found, None otherwise
    """
    if '.' not in field:
        return data.get(field)
    
    keys = field.split('.')
    current = data
    
    for key in keys:
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return None
    
    return current

def apply_json_filters(img_path: str, filters: List[Dict[str, Any]]) -> bool:
    """
    Apply JSON filters to an image by checking its corresponding JSON file.
    
    Args:
        img_path: Path to the image file
        filters: List of filter configurations
        
    Returns:
        True if all enabled filters pass, False otherwise
    """
    if not filters:
        return True  # No filters = no restrictions
    
    # Get corresponding JSON file path
    json_path = os.path.splitext(img_path)[0] + '.json'
    
    if not os.path.exists(json_path):
        return True  # No JSON file = can't apply filters, pass by default
    
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            json_data = json.load(f)
        
        # All enabled filters must pass
        for filter_config in filters:
            if not evaluate_json_filter(json_data, filter_config):
                return False
        
        return True
        
    except (json.JSONDecodeError, IOError):
        return True  # JSON parsing failed, pass by default