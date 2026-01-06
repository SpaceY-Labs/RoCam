# PowerShell Script to create model.mar
torch-model-archiver `
  --model-name sam3 `
  --version 1.0 `
  --serialized-file "C:\Personal-Project\vision-guided-tracker\src\cv\weights\sam3.pt" `
  --handler "C:\Year4\4G06\project-folder\vision-guided-tracker\src\labelling_app\model_archiver\handler.py" `
  --requirements-file "C:\Year4\4G06\project-folder\vision-guided-tracker\src\labelling_app\model_archiver\requirements.txt" `
  --export-path "C:\Year4\4G06\project-folder\vision-guided-tracker\src\labelling_app\model_archiver\model_artifacts" `

Write-Host "Success: model.mar has been created in model_artifacts" -ForegroundColor Green