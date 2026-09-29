import re

with open('Transplant.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find Section 5 (Engraftment)
engraftment_match = re.search(r'<!-- Section 5: Post-Transplant Engraftment -->[\s\S]*?(?=<!-- Section 6: Summary -->)', content)
if not engraftment_match:
    print("Engraftment not found")
    exit(1)
engraftment_html = engraftment_match.group(0)

# Find Section 6 (Summary)
summary_match = re.search(r'<!-- Section 6: Summary -->[\s\S]*?(?=</div>\s*</section>\s*</main>)', content)
if not summary_match:
    print("Summary not found")
    exit(1)
summary_html = summary_match.group(0)

# Rename headers in HTML
new_summary_html = summary_html.replace('<h3 style="margin: 0;">5. Summary</h3>', '<h3 style="margin: 0;">5. Summary</h3>') # Already 5 but just to be sure
new_summary_html = new_summary_html.replace('<!-- Section 6: Summary -->', '<!-- Section 5: Summary -->')

new_engraftment_html = engraftment_html.replace('<h3 style="margin: 0;">5. Engraftment</h3>', '<h3 style="margin: 0;">6. Engraftment</h3>')
new_engraftment_html = new_engraftment_html.replace('<!-- Section 5: Post-Transplant Engraftment -->', '<!-- Section 6: Post-Transplant Engraftment -->')

# Now replace the combined old block with the swapped block
old_combined = engraftment_html + summary_html
new_combined = new_summary_html + new_engraftment_html

content = content.replace(old_combined, new_combined)

with open('Transplant.html', 'w', encoding='utf-8') as f:
    f.write(content)
print("Swapped successfully")
