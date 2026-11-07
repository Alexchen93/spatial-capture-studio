import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('reconstruct', Path(__file__).resolve().parents[1]/'tools'/'reconstruct.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ReconstructionTests(unittest.TestCase):
    def test_pipeline_records_visual_only_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp); images=base/'images';images.mkdir()
            for i in range(3):(images/f'{i}.jpg').write_bytes(b'fixture')
            out=base/'work';calls=[]
            def stub(stage, command, workdir):
                calls.append(command[0])
                if command[0]=='ns-process-data':
                    p=workdir/'processed';p.mkdir();(p/'transforms.json').write_text('{}')
                elif command[0]=='ns-train':
                    p=workdir/'outputs'/'scene';p.mkdir(parents=True);(p/'config.yml').write_text('test')
                else:
                    p=workdir/'exports';p.mkdir();(p/'splat.ply').write_bytes(b'ply')
            with patch.object(module,'check_dependencies'),patch.object(module,'run_step',side_effect=stub):
                module.reconstruct(images,out)
            self.assertEqual(calls,['ns-process-data','ns-train','ns-export'])
            result=json.loads((out/'result.json').read_text())
            self.assertFalse(result['walkable']);self.assertEqual(result['collision_status'],'not_created')
    def test_refuses_nonempty_work_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);images=base/'images';images.mkdir()
            for i in range(3):(images/f'{i}.jpg').write_bytes(b'fixture')
            out=base/'work';out.mkdir();(out/'keep').write_text('do not touch')
            with self.assertRaisesRegex(RuntimeError,'空資料夾'):
                module.reconstruct(images,out)
            self.assertEqual((out/'keep').read_text(),'do not touch')
if __name__=='__main__':unittest.main()
