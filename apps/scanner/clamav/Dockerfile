# Private ClamAV daemon for the knowledge scanner gateway. clamd listens on TCP
# 3310 and freshclam keeps signatures current. Never attach a public domain or
# TCP proxy to this service; mount a volume at /var/lib/clamav.
FROM clamav/clamav:1.4.3
