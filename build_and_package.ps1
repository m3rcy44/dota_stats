#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Builds the Millennium Dota Stats plugin and packages it into a ZIP file.
.DESCRIPTION
    This script performs the following operations:
    1. Builds the plugin using pnpm run build
    2. Copies the runtime assets and backend
    3. Creates a distributable ZIP archive
    4. Cleans up any temporary folders
.NOTES
    Version:        0.1
    Author:         Script Generator
    Creation Date:  2025-04-06
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$tempDirName = "temp_package"
$pluginFolderName = "alowave.dota_stats"  # Folder name inside the ZIP (matches plugin.json "name")

function Write-Status {
    param([string]$Message)
    Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] $Message" -ForegroundColor Cyan
}

function Write-ErrorMessage {
    param([string]$Message)
    Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] ERROR: $Message" -ForegroundColor Red
}

Write-Status "Ensuring pnpm dependencies are installed..."
if (-not (Get-Command "pnpm" -ErrorAction SilentlyContinue)) {
    try {
        Write-Status "pnpm was not found, installing via npm"
        npm install pnpm -g
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install pnpm."
        }
    } catch {
        Write-ErrorMessage "Failed to install pnpm. Please install it manually."
        exit 1
    }
}

Write-Status "Installing dependencies with pnpm..."
try {
    pnpm install
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm install failed."
    }
} catch {
    Write-ErrorMessage "Failed to install dependencies: $($_.Exception.Message)"
    exit 1
}

if (-not (Test-Path "package.json")) {
    throw "package.json file not found in the current directory."
}
try {
    $packageJson = Get-Content -Path "package.json" -Raw | ConvertFrom-Json
    if (-not (Get-Member -InputObject $packageJson -Name "name" -MemberType Properties)) {
        throw "The 'name' field is missing from package.json."
    }
    if (-not (Get-Member -InputObject $packageJson -Name "version" -MemberType Properties)) {
        throw "The 'version' field is missing from package.json."
    }
    $packageName = $packageJson.name
    $packageVersion = $packageJson.version
    Write-Status "Packaging $packageName@$packageVersion"
}
catch {
    throw "Failed to parse package.json: $($_.Exception.Message)"
}

$zipFileName = "$packageName-$packageVersion.zip"

try {
    Write-Status "Building the plugin with 'pnpm run build'..."
    pnpm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed with exit code $LASTEXITCODE"
    }

    Write-Status "Preparing temporary staging directory..."
    if (Test-Path $tempDirName) {
        Remove-Item -Path $tempDirName -Recurse -Force
    }
    New-Item -Path $tempDirName -ItemType Directory | Out-Null
    New-Item -Path "$tempDirName/$pluginFolderName" -ItemType Directory | Out-Null

    Write-Status "Copying plugin.json..."
    Copy-Item -Path "plugin.json" -Destination "$tempDirName/$pluginFolderName"

    Write-Status "Copying compiled assets from .millennium/Dist..."
    if (-not (Test-Path ".millennium/Dist")) {
        throw "Directory .millennium/Dist not found. Build may have failed."
    }
    New-Item -Path "$tempDirName/$pluginFolderName/.millennium/Dist" -ItemType Directory -Force | Out-Null
    Copy-Item -Path ".millennium/Dist/*" -Destination "$tempDirName/$pluginFolderName/.millennium/Dist" -Recurse

    Write-Status "Copying static assets..."
    Copy-Item -Path "static" -Destination "$tempDirName/$pluginFolderName" -Recurse

    Write-Status "Copying backend files..."
    Copy-Item -Path "backend" -Destination "$tempDirName/$pluginFolderName" -Recurse

    Write-Status "Creating ZIP archive '$zipFileName'..."
    if (Test-Path $zipFileName) {
        Remove-Item -Path $zipFileName -Force
    }
    Compress-Archive -Path "$tempDirName/*" -DestinationPath $zipFileName

    if (-not (Test-Path $zipFileName)) {
        throw "Failed to create ZIP archive."
    }
    Write-Status "Archive created: $zipFileName"

    Write-Status "Cleaning up staging area..."
    Remove-Item -Path $tempDirName -Recurse -Force

    Write-Status "Plugin packaging completed successfully!"
}
catch {
    Write-ErrorMessage $_.Exception.Message
    if (Test-Path $tempDirName) {
        Write-Status "Cleaning up temporary directory after error..."
        Remove-Item -Path $tempDirName -Recurse -Force
    }
    exit 1
}
