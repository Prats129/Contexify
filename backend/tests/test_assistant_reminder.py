"""Synthetic reminder data, disposable SQL and loopback Turso; no OS or provider effects."""

import base64
import json
import time
import unittest
import uuid
from unittest.mock import patch

import test_assistant_security as bootstrap
import test_assistant_volume as volume_tests
from pydantic import SecretStr

from app.assistant.private_data import PrivateDataKeys, PrivateStorageUnavailable
from app.core.security import digest
from app.db import database

KEYRING = json.dumps(
    {
        "active": "fixture-v1",
        "keys": {"fixture-v1": base64.b64encode(bytes(range(32))).decode()},
    }
)


class PrivateDataTests(unittest.TestCase):
    def test_authenticated_encryption_rotation_binding_and_no_plaintext_fallback(self):
        keys = PrivateDataKeys.parse(KEYRING)
        key_id, cipher = keys.seal(
            "synthetic private reminder", "fixture-user/device/object"
        )
        self.assertNotIn(b"synthetic", cipher)
        self.assertEqual(
            keys.open(key_id, cipher, "fixture-user/device/object"),
            "synthetic private reminder",
        )
        rotated = PrivateDataKeys.parse(
            json.dumps(
                {
                    "active": "v2",
                    "keys": {
                        "fixture-v1": base64.b64encode(bytes(range(32))).decode(),
                        "v2": base64.b64encode(bytes(reversed(range(32)))).decode(),
                    },
                }
            )
        )
        self.assertEqual(
            rotated.open(key_id, cipher, "fixture-user/device/object"),
            "synthetic private reminder",
        )
        self.assertEqual(rotated.seal("new", "fixture-user/device/object")[0], "v2")
        for context, value in (
            ("other-user/device/object", cipher),
            ("fixture-user/device/object", cipher[:-1] + bytes([cipher[-1] ^ 1])),
        ):
            with self.assertRaises(PrivateStorageUnavailable):
                keys.open(key_id, value, context)
        for value in (
            None,
            "{}",
            "[]",
            '{"active":"missing","keys":{}}',
            KEYRING.replace("fixture-v1", "bad/key"),
        ):
            with self.assertRaises(PrivateStorageUnavailable):
                PrivateDataKeys.parse(value)


class ReminderTests(bootstrap.AssistantSecurityFixture):
    api = volume_tests.AssistantVolumeTests.api
    claim_body = volume_tests.AssistantVolumeTests.claim_body

    def setUp(self):
        super().setUp()
        self.prepare()

    def prepare(self):
        for key, value in {
            "ASSISTANT_EXECUTION_ENABLED": True,
            "ASSISTANT_PRIVATE_DATA_KEYRING": SecretStr(KEYRING),
        }.items():
            changed = patch.object(bootstrap.fixture.settings, key, value, create=True)
            changed.start()
            self.addCleanup(changed.stop)
        self.device = self.enroll()
        self.management = self.device_session(self.device)
        response = self.api(
            "POST", "/reminder/sessions", token=self.management, json={}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["scope"], "assistant:reminder")
        self.simulation = response.json()["access_token"]

    def details(self):
        return {
            "reminder_id": str(uuid.uuid4()),
            "title": "SYNTHETIC-PRIVATE-REMINDER",
            "date": "2026-11-20",
            "time": "09:00",
            "zone": "Asia/Kolkata",
            "repeat": "none",
            "until": None,
            "overlap": "ask",
            "occurrences": [int((time.time() + 3600) * 1000)],
        }

    def create(
        self,
        capability="reminder.create",
        reminder_id=None,
        commitment=None,
        mode=None,
        revision=None,
        plan_id=None,
    ):
        return self.api(
            "POST",
            "/reminder/operations",
            json={
                "protocol_version": 2,
                "plan_id": plan_id or str(uuid.uuid4()),
                "plan_revision": 1,
                "step_id": 0,
                "action": {
                    "capability_id": capability,
                    "commitment": commitment or "a" * 64,
                    "reminder_id": None
                    if capability == "reminder.storage"
                    else reminder_id or str(uuid.uuid4()),
                    "storage_mode": mode,
                    "settings_revision": revision,
                },
            },
        )

    def path(self, task):
        return "/reminder/tasks/" + task["task_id"]

    def settle(self, task, outcome):
        challenge = self.api(
            "POST",
            self.path(task) + "/authorization-challenge",
            json={"expected_revision": 1},
        )
        self.assertEqual(challenge.status_code, 200, challenge.text)
        self.assertEqual(json.loads(challenge.json()["payload"])["mode"], "reminder")
        permit = self.api(
            "POST",
            self.path(task) + "/authorize",
            json={"expected_revision": 1, **self.proof(challenge.json())},
        )
        self.assertEqual(permit.status_code, 200, permit.text)
        body = self.claim_body(permit.json())
        claim = self.api("POST", self.path(task) + "/claim", json=body)
        self.assertEqual(claim.status_code, 200, claim.text)
        self.assertEqual(
            claim.json()["execution"],
            getattr(self, "expected_execution", "android_owned_reminder"),
        )
        self.assertEqual(
            self.api("POST", self.path(task) + "/claim", json=body).status_code, 409
        )
        result = {
            "expected_revision": 3,
            "claim_id": claim.json()["claim_id"],
            "outcome": outcome,
        }
        receipt = self.api("POST", self.path(task) + "/receipt-challenge", json=result)
        self.assertEqual(receipt.status_code, 200, receipt.text)
        return self.api(
            "POST",
            self.path(task) + "/receipt",
            json={**result, **self.proof(receipt.json())},
        )

    def consent(self, mode="account", revision=0):
        task = self.create("reminder.storage", mode=mode, revision=revision)
        self.assertEqual(task.status_code, 200, task.text)
        response = self.settle(task.json(), "storage_updated")
        self.assertEqual(response.status_code, 200, response.text)

    def scheduled(self):
        details = self.details()
        payload = json.dumps(details, ensure_ascii=False, separators=(",", ":"))
        salt = "s" * 43
        commitment = digest("reminder-v1\n" + salt + "\n" + payload)
        task = self.create(reminder_id=details["reminder_id"], commitment=commitment)
        self.assertEqual(task.status_code, 200, task.text)
        response = self.settle(task.json(), "schedule_requested")
        self.assertEqual(response.status_code, 200, response.text)
        return details, {
            "task_id": task.json()["task_id"],
            "salt": salt,
            "payload_json": payload,
        }

    def test_device_only_control_never_stores_private_details(self):
        storage = self.api("POST", "/reminder/storage", json={}).json()
        self.assertEqual(storage["mode"], "device_only")
        self.assertEqual(storage["revision"], 0)
        details, payload = self.scheduled()
        self.assertEqual(
            self.api("POST", "/reminder/stored/save", json=payload).status_code, 403
        )
        with database.get_db_connection() as conn:
            row = dict(
                self.database_row(
                    conn,
                    "SELECT * FROM assistant_reminder_tasks WHERE id=?",
                    (payload["task_id"],),
                )
            )
            self.assertNotIn(details["title"], json.dumps(row))
            self.assertEqual(
                conn.execute(
                    "SELECT COUNT(*) AS count FROM assistant_reminder_copies"
                ).fetchone()["count"],
                0,
            )

    def test_opted_in_copy_is_encrypted_owned_and_read_only(self):
        self.consent()
        details, payload = self.scheduled()
        saved = self.api("POST", "/reminder/stored/save", json=payload)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(
            self.api("POST", "/reminder/stored/save", json=payload).json(), saved.json()
        )
        with database.get_db_connection() as conn:
            before = dict(
                self.database_row(
                    conn,
                    "SELECT * FROM assistant_reminder_copies WHERE id=?",
                    (details["reminder_id"],),
                )
            )
        self.assertNotIn(details["title"], json.dumps(before))
        page = self.api("POST", "/reminder/stored/list", json={})
        self.assertEqual(page.status_code, 200, page.text)
        self.assertEqual(page.json()["items"][0]["details"], details)
        selected = self.api(
            "POST",
            "/reminder/stored/read",
            json={"reminder_id": details["reminder_id"]},
        )
        self.assertEqual(selected.status_code, 200, selected.text)
        self.assertEqual(selected.json()["details"], details)
        with database.get_db_connection() as conn:
            after = dict(
                self.database_row(
                    conn,
                    "SELECT * FROM assistant_reminder_copies WHERE id=?",
                    (details["reminder_id"],),
                )
            )
        self.assertEqual(before, after)
        for token in (self.token, self.other_token, self.management):
            self.assertEqual(
                self.api(
                    "POST", "/reminder/stored/list", token=token, json={}
                ).status_code,
                401,
            )

    def test_changed_body_without_a_new_signed_commitment_is_rejected(self):
        self.consent()
        _, payload = self.scheduled()
        changed = {
            **payload,
            "payload_json": payload["payload_json"].replace(
                "SYNTHETIC-PRIVATE-REMINDER", "DIFFERENT-PRIVATE-REMINDER"
            ),
        }
        self.assertEqual(
            self.api("POST", "/reminder/stored/save", json=changed).status_code, 409
        )
        self.assertEqual(
            self.api("POST", "/reminder/stored/list", json={}).json()["items"], []
        )

    def test_storage_revision_race_never_overwrites_a_newer_choice(self):
        first = self.create("reminder.storage", mode="account", revision=0).json()
        stale = self.create("reminder.storage", mode="device_only", revision=0).json()
        self.assertEqual(self.settle(first, "storage_updated").status_code, 200)
        self.assertEqual(self.settle(stale, "storage_updated").status_code, 409)
        current = self.api("POST", "/reminder/storage", json={}).json()
        self.assertEqual((current["mode"], current["revision"]), ("account", 1))

    def test_different_account_cannot_read_or_delete_another_accounts_copy(self):
        self.consent()
        details, payload = self.scheduled()
        self.assertEqual(
            self.api("POST", "/reminder/stored/save", json=payload).status_code, 200
        )
        self.token = self.other_token
        self.installation = str(uuid.uuid4())
        self.key = bootstrap.ec.generate_private_key(bootstrap.ec.SECP256R1())
        self.public_key = base64.b64encode(
            self.key.public_key().public_bytes(
                bootstrap.serialization.Encoding.X962,
                bootstrap.serialization.PublicFormat.UncompressedPoint,
            )
        ).decode()
        self.device = self.enroll()
        management = self.device_session(self.device)
        self.simulation = self.api(
            "POST", "/reminder/sessions", token=management, json={}
        ).json()["access_token"]
        self.assertEqual(
            self.api("POST", "/reminder/stored/list", json={}).json()["items"], []
        )
        self.assertEqual(
            self.create(
                "reminder.delete_saved", reminder_id=details["reminder_id"]
            ).status_code,
            404,
        )
        self.assertEqual(
            self.api(
                "POST",
                "/reminder/stored/read",
                json={"reminder_id": details["reminder_id"]},
            ).status_code,
            404,
        )

    def test_delete_saved_copy_requires_its_own_confirmed_operation(self):
        self.consent()
        details, payload = self.scheduled()
        self.api("POST", "/reminder/stored/save", json=payload)
        task = self.create(
            "reminder.delete_saved", reminder_id=details["reminder_id"]
        ).json()
        self.assertEqual(
            len(self.api("POST", "/reminder/stored/list", json={}).json()["items"]), 1
        )
        response = self.settle(task, "saved_copy_deleted")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            self.api("POST", "/reminder/stored/list", json={}).json()["items"], []
        )

    def test_turning_storage_off_deletes_this_devices_copies_and_blocks_late_upload(
        self,
    ):
        self.consent()
        _, payload = self.scheduled()
        self.assertEqual(
            self.api("POST", "/reminder/stored/save", json=payload).status_code, 200
        )
        self.consent("device_only", 1)
        self.assertEqual(
            self.api("POST", "/reminder/stored/list", json={}).json()["items"], []
        )
        self.assertEqual(
            self.api("POST", "/reminder/stored/save", json=payload).status_code, 403
        )
        self.assertEqual(
            self.create("reminder.storage", mode="account", revision=0).status_code, 409
        )

    def test_missing_key_never_enables_plaintext_account_storage(self):
        with patch.object(
            bootstrap.fixture.settings, "ASSISTANT_PRIVATE_DATA_KEYRING", None
        ):
            self.assertFalse(
                self.api("POST", "/reminder/storage", json={}).json()[
                    "account_storage_available"
                ]
            )
            self.assertEqual(
                self.create("reminder.storage", mode="account", revision=0).status_code,
                503,
            )
            self.assertEqual(self.create().status_code, 200)

    def test_cancel_deletes_the_owned_copy_and_never_claims_notification_delivery(self):
        self.consent()
        details, payload = self.scheduled()
        self.api("POST", "/reminder/stored/save", json=payload)
        task = self.create("reminder.cancel", reminder_id=details["reminder_id"]).json()
        response = self.settle(task, "reminder_cancelled")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            self.api("POST", "/reminder/stored/save", json=payload).status_code, 409
        )
        self.assertEqual(
            self.api("POST", "/reminder/stored/list", json={}).json()["items"], []
        )

    def test_private_validation_and_corruption_return_no_payload(self):
        self.consent()
        details, payload = self.scheduled()
        invalid = {
            **payload,
            "payload_json": json.dumps({**details, "extra": "PRIVATE-MARKER"}),
        }
        response = self.api("POST", "/reminder/stored/save", json=invalid)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("PRIVATE-MARKER", response.text)
        self.api("POST", "/reminder/stored/save", json=payload)
        with database.get_db_connection(write=True) as conn:
            conn.execute(
                "UPDATE assistant_reminder_copies SET ciphertext=? WHERE id=?",
                (base64.b64encode(b"broken").decode(), details["reminder_id"]),
            )
        response = self.api("POST", "/reminder/stored/list", json={})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(details["title"], response.text)


class TursoReminderTests(ReminderTests):
    setUp = volume_tests.TursoAssistantVolumeTests.setUp


class IOSReminderTests(ReminderTests):
    expected_execution = "ios_owned_schedule"

    def challenge(self, token=None):
        response = self.request(
            "POST",
            "/enrollment/challenge",
            token or self.token,
            json={
                "installation_id": self.installation,
                "public_key": self.public_key,
                "platform": "ios",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_ios_never_gains_android_effect_scopes(self):
        for mode in ("volume", "brightness", "application", "alarm"):
            response = self.api(
                "POST", f"/{mode}/sessions", token=self.management, json={}
            )
            self.assertEqual(response.status_code, 403, response.text)


class TursoIOSReminderTests(IOSReminderTests):
    setUp = volume_tests.TursoAssistantVolumeTests.setUp


if __name__ == "__main__":
    unittest.main()
