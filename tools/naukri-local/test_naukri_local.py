import unittest
from datetime import datetime
from naukri_local import scheduled_slot


class ScheduleTests(unittest.TestCase):
    def test_morning_starts_at_eight_ist(self):
        self.assertIsNone(scheduled_slot(datetime.fromisoformat("2026-10-29T02:29:00+00:00")))
        self.assertEqual(scheduled_slot(datetime.fromisoformat("2026-10-29T02:30:00+00:00")), "2026-10-29:morning")
        self.assertIsNone(scheduled_slot(datetime.fromisoformat("2026-10-29T06:30:00+00:00")))

    def test_evening_starts_at_nine_ist(self):
        self.assertIsNone(scheduled_slot(datetime.fromisoformat("2026-10-29T15:29:00+00:00")))
        self.assertEqual(scheduled_slot(datetime.fromisoformat("2026-10-29T15:30:00+00:00")), "2026-10-29:evening")
        self.assertIsNone(scheduled_slot(datetime.fromisoformat("2026-10-29T17:30:00+00:00")))


if __name__ == "__main__":
    unittest.main()